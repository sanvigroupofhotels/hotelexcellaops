# HEOS MCP Server — Discovery & Architecture Review

Analysis only. No code, schema, or data changes proposed for this step.

## Starting point: an MCP server already exists

`src/lib/mcp/` already ships a working, OAuth-protected MCP server mounted at `/mcp` with two read tools (`whoami`, `list_bookings`), Supabase OAuth 2.1 as the authorization server, and a consent screen. So Phase 1 is an extension, not a greenfield build.

Important caveat: both existing tools call `supabase.from(...)` directly inside the tool handler. That is acceptable for pure reads under RLS, but it is exactly the pattern that must NOT be extended to writes — it bypasses the shared engines.

---

## A. What HEOS already has that MCP can reuse

**Shared engines (documented in** `docs/shared-engines.md`**)** — one owner per domain, all side-effecting logic already funnelled through them:

- Booking lifecycle: `bookings-api.ts` (`setBookingStatus` — now the central document/balance gate), `booking-status.ts` (`transitionBookingStatus`), `booking-create.ts`, `booking-stay.ts`
- Booking Items (operational rooms): `booking-items-api.ts`, `booking-item-operations-api.ts` (`checkInBookingItem`, `checkOutBookingItem`, `moveBookingItemRoom`), `booking-item-lifecycle.ts` (fan-out + derivation), `booking-item-bulk.ts`
- Occupancy truth: `booking-room-assignments-api.ts` (+ `split_room_assignment` RPC), `room-occupancy.ts`, `stay-segments.ts`
- Availability: `room-availability.ts`, `room-inventory.ts`, `room-type-availability-core.ts`, `rooms-api.ts`
- Pricing & charges: `pricing.ts` (`computePricing`), `rates.ts`, `guest-allocation.ts`, `booking-charges-api.ts`, `charge-catalog-api.ts`, `expected-time-charges.ts`
- Money: `booking-payments-api.ts`, `razorpay-completion.server.ts`, `cash-api.ts`, `cash-report.ts`
- Gates: `checkout-validation.ts` (`assertCheckoutAllowed`), guest-document gate in `setBookingStatus` / `checkInBookingItem`
- Ops reads: `in-house.ts`, `house-view-placement.ts`, `booking-search.ts`, `night-audit-api.ts` (`getBusinessDate`, `getPendingForAudit`), `hk-tasks.ts`, `complaints-api.ts`, `reporting/*`, `owner-dashboard.functions.ts`, `invoice-document.ts`
- Night Audit: `night-audit-sessions-api.ts` (`closeSession` = only Business-Date advance)

**Auth / authz / audit**: Supabase Auth + RLS on every table; `user_roles` with `admin | owner | fo_staff | housekeeping`; `has_role`, `my_permissions`, `user_effective_permissions` RPCs; `PermissionGate`; `activity_log` plus per-domain trails (`booking_activities`, `booking_payment_activities`, `complaint_activities`, …); notification engine for human awareness.

---

## B. What needs to be built (the real gaps)

1. **Engine reachability from the MCP runtime.** The engines are browser-side modules importing `@/integrations/supabase/client`. MCP tools run in the Worker. Any write tool needs a server-callable engine boundary — either move/wrap the engine entry points into server-safe modules that accept a caller-scoped Supabase client, or expose them as server functions the tool calls with the caller's bearer token. Until this exists, no write tool should ship.
2. **Role/permission check inside tools.** Tools currently rely on RLS only. Tools must additionally resolve `user_effective_permissions` and refuse the call when the permission the equivalent screen requires is absent — mirroring `PermissionGate`.
3. **AI actor attribution in audit.** `activity_log` has no `actor_type` (`user` / `ai_agent` / `automation`) and no client/agent id. Already flagged in `docs/ai-readiness.md` §5. Needed before any write.
4. **Idempotency keys** on write paths, so a retrying agent cannot double-charge or double-check-in (also flagged in `docs/ai-readiness.md`).
5. **Confirmation / approval protocol** for money, status, and cancellation tools: a two-step propose → confirm token, since MCP clients auto-approve tools too easily.
6. **Read-tool shaping**: PII minimisation (no ID documents, no staff PII, no tokens), row caps, and stable JSON shapes.
7. **Rate limiting / abuse guard** per OAuth client.

---

## C. What should NOT be exposed

- Direct SQL / arbitrary query tools of any kind.
- Any write that touches `booking_room_assignments`, `booking_items`, `bookings.status`, or `booking_payments` without going through the owning engine.
- Night Audit close / Business-Date advance (`closeSession`) — never agent-initiated.
- Guest ID documents, storage objects, signatures.
- `user_roles`, `role_permissions`, `app_settings` writes (especially `business_date`), master data.
- Backfill/repair routines (`backfill_booking_item_segment_links`, prune/split helpers) — historical truth must never be rewritten to satisfy an AI request.
- Refunds / payment reversals; delete of bookings, customers, complaints.
- Outbound guest messaging (WhatsApp / email send). Drafts only.

---

## D. Proposed Phase 1 architecture (read-only)

```text
MCP client (Claude/ChatGPT)
  → OAuth 2.1 (Supabase AS) + consent screen        [already built]
  → /mcp  (mcp-js, verifies bearer, client_id claim) [already built]
  → tool handler
      ├─ resolve identity: ctx.getUserId/Email
      ├─ authorize: user_effective_permissions check  [to build]
      ├─ read via caller-scoped Supabase client (RLS as user)
      │   or via a read engine wrapper (Business Date, House View, in-house)
      └─ shape + cap + redact response
```

Principles: read-only, per-user token, RLS as the ceiling and permissions as the floor, Business Date always from `getBusinessDate()` (never `new Date()`), no derived math the engines already own.

---

## E. Proposed first 15–20 tools (all read-only)


| Tool                        | Existing HEOS source                             | Data touched               | Rules already enforced     | Authz           | Notes                                   |
| --------------------------- | ------------------------------------------------ | -------------------------- | -------------------------- | --------------- | --------------------------------------- |
| `whoami`                    | existing                                         | `user_roles`               | RLS                        | any             | shipped                                 |
| `get_business_date`         | `night-audit-api.getBusinessDate`                | `app_settings`             | BD ≤ calendar date trigger | any             | clock for all other tools               |
| `search_bookings`           | `booking-search.ts`                              | bookings, items, customers | RLS                        | bookings.view   | replaces ad-hoc `list_bookings` filters |
| `get_booking`               | `bookings-api.getBooking`                        | bookings                   | RLS                        | bookings.view   | redact internal notes for non-manage    |
| `get_booking_items`         | `booking-items-api`                              | booking_items              | RLS                        | bookings.view   | operational room truth                  |
| `get_booking_balance`       | `checkout-validation` / payments engine          | payments, charges          | shared balance math        | bookings.view   | Guest Credit semantics preserved        |
| `list_booking_charges`      | `booking-charges-api`                            | booking_charges            | RLS                        | bookings.view   | per-room attribution included           |
| `list_booking_payments`     | `booking-payments-api`                           | booking_payments           | RLS                        | payments.view   | no gateway payloads                     |
| `arrivals`                  | `night-audit-api` / item queries                 | bookings, items            | BD-scoped                  | bookings.view   | item-aware                              |
| `departures`                | same                                             | bookings, items            | BD-scoped                  | bookings.view   | item-aware                              |
| `in_house_guests`           | `in-house.ts`                                    | items, segments            | single in-house definition | bookings.view   | &nbsp;                                  |
| `house_view`                | `house-view-placement.ts` + `stay-segments.ts`   | segments, items            | lane/turnover rules        | bookings.view   | date-window capped                      |
| `room_status`               | `rooms-api`, `hk-status`                         | rooms, hk_tasks            | RLS                        | rooms.view      | &nbsp;                                  |
| `room_availability`         | `room-inventory` / `room-type-availability-core` | items, blocks              | nightly peak demand        | bookings.view   | never re-derive                         |
| `list_housekeeping_tasks`   | `hk-tasks.ts`                                    | housekeeping_tasks         | RLS                        | hk.view         | &nbsp;                                  |
| `complaints_summary`        | `complaints-api`                                 | complaints                 | RLS                        | complaints.view | counts + open ages                      |
| `night_audit_status`        | `night-audit-api.getPendingForAudit`             | bookings, items, sessions  | item-aware blockers        | na.view         | read-only, no close                     |
| `occupancy_revenue_summary` | `reporting/*`, `owner-dashboard.functions`       | aggregates                 | date-range engine          | reporting.view  | owner/admin only                        |
| `cash_summary`              | `cash-report.ts`                                 | cash_transactions          | day/category rules         | cash.view       | owner/admin only                        |
| `get_invoice_preview`       | `invoice-document.ts`                            | booking + charges          | shared invoice math        | bookings.view   | returns data, not a stored PDF          |


Write candidates deferred to Phase 2+, each mapped to its existing engine and each requiring explicit confirmation: assign/unassign room and move room (`moveBookingItemRoom`, `splitAssignment`), check-in / check-out per item (`checkInBookingItem` / `checkOutBookingItem` with the docs and balance gates and role-aware override), add charge (`booking-charges-api`), update occupant, add/remove booking item (`replaceBookingItems` — high risk, state-preserving path), create/modify booking (`booking-create`, `booking-stay`), record payment (`booking-payments-api`), update HK status, cancel booking, generate invoice. Money, guest status, cancellation, and anything touching occupancy history are confirmation-required by definition; Night Audit close stays out entirely.

---

## F. Security / auth / audit

Per-user OAuth token only (no service role anywhere in `src/lib/mcp/`); `requireOAuthClientClaim` stays on so pasted app sessions are rejected; issuer pinned to the direct Supabase host; permissions checked in-tool, not just RLS; every read capped and PII-minimised; every future write emits `activity_log` with AI actor attribution plus an idempotency key; notification engine used for human awareness of agent actions.

---

## G. Decisions to resolve together

1. Should MCP identity be a real staff user (RLS + their permissions), or a dedicated restricted "AI agent" user? Recommendation: real staff user.
2. Per-role tool visibility: hide owner/finance tools from `fo_staff` and `housekeeping`, or show and refuse? Recommendation: refuse with a clear message, keep one manifest.
3. Do we add `actor_type` to `activity_log` now (small migration) or defer until Phase 2?
4. Preferred write boundary: server-safe engine wrappers, or reuse existing `*.functions.ts` server functions from tools?
5. Confirmation UX: rely on the MCP client's own approval prompt, or a HEOS-side propose/confirm token?
6. Which write tool is worth doing first once the boundary exists — add charge, or per-room check-in?
7. Any hard exclusion list from your side (e.g. never expose revenue to `fo_staff`)?

---

## Next step

If this reading matches your intent, the follow-up plan would be Phase 1 only: add the read tools in section E on top of the existing MCP server, plus the in-tool permission check — no writes, no schema changes.

&nbsp;

&nbsp;

My comments - 

&nbsp;

> Proceed with MCP Phase 1 — all proposed read-only tools from your architecture review.

&nbsp;

Implement the full Phase 1 read-only MCP surface:

&nbsp;

whoami

&nbsp;

get_business_date

&nbsp;

search_bookings

&nbsp;

get_booking

&nbsp;

get_booking_items

&nbsp;

get_booking_balance

&nbsp;

list_booking_charges

&nbsp;

list_booking_payments

&nbsp;

arrivals

&nbsp;

departures

&nbsp;

in_house_guests

&nbsp;

house_view

&nbsp;

room_status

&nbsp;

room_availability

&nbsp;

list_housekeeping_tasks

&nbsp;

complaints_summary

&nbsp;

night_audit_status

&nbsp;

occupancy_revenue_summary

&nbsp;

cash_summary

&nbsp;

get_invoice_preview

&nbsp;

&nbsp;

Requirements:

&nbsp;

Keep the existing /mcp endpoint and OAuth architecture.

&nbsp;

Read-only only. No write tools in this phase.

&nbsp;

Use the authenticated HEOS user's identity, existing RLS, and appropriate user_effective_permissions.

&nbsp;

Do not introduce a service-role bypass.

&nbsp;

Do not expose arbitrary SQL/database querying.

&nbsp;

Reuse existing HEOS shared engines/services wherever they already exist. Do not duplicate business logic inside MCP.

&nbsp;

Business Date must come from the existing HEOS Business Date engine, never from the AI/client clock.

&nbsp;

Preserve Booking → Booking Item → Occupancy Segment architecture.

&nbsp;

Preserve all existing availability, pricing, charge, occupancy, House View, Night Audit and reporting rules.

&nbsp;

Apply appropriate PII minimisation, response caps, and stable JSON response shapes.

&nbsp;

Do not expose ID documents, signatures, tokens, sensitive staff data, or internal credentials.

&nbsp;

Do not make database/schema changes unless absolutely required for this read-only phase. If you believe one is necessary, stop and explain it before making the change.

&nbsp;

Do not modify existing PMS behaviour.

&nbsp;

Do not implement any future write architecture yet.

&nbsp;

&nbsp;

For every tool, ensure errors are clear and useful to the MCP client and that authorization failures do not leak data.

&nbsp;

After implementation, test every Phase 1 tool against realistic HEOS data and run the existing HEOS test suite/typecheck.

&nbsp;

Report:

&nbsp;

1. Tools implemented.

&nbsp;

&nbsp;

2. Exact HEOS source/engine used by each.

&nbsp;

&nbsp;

3. Authentication/permission behavior.

&nbsp;

&nbsp;

4. Any schema or architecture changes made.

&nbsp;

&nbsp;

5. Test results.

&nbsp;

&nbsp;

6. Any limitations discovered when exercising the tools through MCP.

&nbsp;

&nbsp;

&nbsp;

Do not implement Phase 2 writes yet.

&nbsp;

The objective is to make Claude a reliable read-only HEOS operations assistant while keeping HEOS as the single source of truth.

&nbsp;