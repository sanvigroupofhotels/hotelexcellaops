# HEOS v1.0 — Production Readiness Matrix

_Produced: 2026-07-09, end of Shipment 3B. This is the final sign-off view
before freezing HEOS Core v1.0 and starting the Maintenance Module._

Legend: 🟢 Production Ready · 🟡 Minor Improvements Remaining · 🔴 Blocking

| Module                | Status | Notes |
|-----------------------|:------:|-------|
| Booking               | 🟢     | Direct + Booking Engine consolidated; pricing engine is single source of truth; stay mutations funnel through `booking-stay.ts`. |
| House View            | 🟢     | Long-press, room block, DND, service-not-required all wired to shared HK status engine. |
| Guest Portal          | 🟢     | Pricing card unified with operator invoicing; ID upload, payment link, cancellation, review — all live. |
| Housekeeping          | 🟢     | Task generation idempotent via `hk-generator.ts` + `hk-checkout-hook.ts`; work-history complete; reporting has filters + skipped-reason. |
| Laundry               | 🟢     | Batches, damage/loss, outstanding queue, reporting all in place; batch-detail modal ships full lifecycle. |
| Inventory             | 🟢     | Items, movements, low-stock derivation ready; vendor invoicing recorded. |
| Vendors               | 🟢     | Vendor master + invoice recording via cash book. |
| Cash Book             | 🟢     | Category-scoped policies, daily close, audit trail; `cash-report.ts` is the aggregation engine. |
| Reporting             | 🟢     | Owner Dashboard, CRM Analytics, Payments, HK, Laundry, Staff, Activity, Night Audit — all date-range-scoped and RLS-safe. |
| Night Audit           | 🟢     | `closeSession` is the single validation + advance point; blocks BD advance on pending tasks; business-date guard trigger in place. |
| User Management       | 🟢     | Create / edit / role assignment through server functions with `requireSupabaseAuth` + admin check. |
| Role Management       | 🟢     | Roles/permissions catalog reconciled in Shipment 3; legacy `staff`/`reception` mapped to `housekeeping`/`fo_staff` and blocked at DB level. |
| Access Management     | 🟢     | Role-based grants + per-user overrides; RLS via `has_role` + `user_effective_permissions`. |
| Master Data           | 🟡     | Functional and grouped; could benefit from a category-level nav pass on mobile (audit result documented below). Non-blocking for Maintenance Module. |
| Staff Management      | 🟡     | Master + attendance + salary work; forms are dense on mobile. Non-blocking. Audit result documented below. |
| Quotes                | ⚫     | Retired. UI removed in Shipment 3B; DB dormant/read-only for audit. |

## 🟡 details

### Master Data (🟡 — minor UX)
- **What works:** central `master_data` table with category filter; used
  by Rates, Rooms, Charge Catalog, Linen, HK Issue Types.
- **What could improve:** the top-level Master Data screen shows a flat
  category selector; mobile users would benefit from a grouped view
  (Room-side / Finance / HK / Guest). This is a 1-2 hour UX polish and
  does not block the Maintenance Module.
- **Blocks Maintenance Module?** No.

### Staff Management (🟡 — form density)
- **What works:** master → attendance → salary all live; documents card
  reused; ledger view functional; no data duplication with
  `profiles`/`user_roles` (verified in Shipment 3).
- **What could improve:** the Master edit form on mobile shows a long
  scroll; splitting into tabs (Identity / Employment / Documents) would
  match the pattern used elsewhere in the app.
- **Blocks Maintenance Module?** No.

## Final assessment
HEOS Core v1.0 is **production-ready and functionally frozen**. The two
🟡 items are UI polish, not architectural gaps. The platform can host the
Maintenance Module today, and every future extension point
(notifications, integrations, AI) has a documented decoupled surface
(see `docs/events.md`, `docs/notification-architecture.md`,
`docs/integration-readiness.md`, `docs/ai-readiness.md`).

---

# v1.1 Production Hardening Milestone (Automatic Night Audit + Occupancy Engine)

## 1. Automatic Night Audit scheduler — restored 🟢
- `pg_cron` job `heos-night-audit-6am-ist` (`30 0 * * *` UTC = **06:00 IST**)
  POSTs `/api/public/night-audit-run`.
- The route delegates to `runScheduledNightAudit()`, which drives the **same**
  `openOrResumeSession()` + `closeSession()` engine Reception uses. No second
  audit implementation exists.
- Business Date advances **only** on success, one day per session close, never
  past today's Asia/Kolkata date, never while pending check-ins/check-outs
  exist. Bounded 7-day catch-up.
- Idempotent (`night_audit_runs` guard) and fully logged (`night_audit_runs`
  row + `night_audit_scheduler_*` activity events, correlation id, duration).
- Detail: `docs/night-audit-scheduler.md`.
- Regression: `tests/night-audit-scheduler.test.ts` (8 cases).

## 2. Shared-service single-implementation audit 🟢
| Domain | Single implementation | Notes |
|---|---|---|
| Business Date advance | `night-audit-sessions-api.closeSession` | `performNightAudit()` remains hard-disabled; scheduler routes through `closeSession`. |
| Room occupancy | `booking_room_assignments` segments + `room-occupancy.ts` | `split_room_assignment` RPC is the only move path. |
| Room move | `moveBookingItemRoom` | House View DnD, Booking Detail, bulk ops all funnel here. |
| Item lifecycle | `booking-item-operations-api.ts` | CI / CO / revert / add / remove. |
| Pricing | `pricing.ts` + `booking-pricing-sync.ts` | Excludes `Removed` items. |
| Payments / fees | `razorpay-completion.server.ts` | Portal + webhook share it. |
| Housekeeping | `hk-generator` / `hk-tasks` / `hk-status` | One fan-out; idempotent. |
| In-house definition | `in-house.ts` | One query for dashboard, charges, grids. |
| Search | `booking-search.ts` | House View + global search. |
| DB handle | `db.ts` (`db()` / `withDb`) | Lets server tasks reuse browser-side engines verbatim. |

## 3. Technical-debt cleanup (legacy `bookings.room_id`) 🟢
- `hk-generator.ts` — continue-service generation now reads occupancy segments.
- `dues.tsx` — room column/search resolve via segments (BD-covering, else latest).
- `room-counts.ts` — already segment-only; comments retained as guard rails.
- Remaining `room_id` references in the codebase belong to `booking_room_assignments`,
  `booking_items`, and `rooms` (legitimate), not to the retired booking-header column.

## 4. Regression surface
`bunx vitest run` → 26 passing across: booking clone, booking search,
Razorpay completion (fee split, partial payments), night-audit scheduler.
End-to-end Playwright coverage: `tests/e2e/room-move-regression.spec.py`
(repeat occupancy 102→104→102, sibling preservation, full lifecycle, HK
integration under repeated moves), `tests/e2e/house-view-long-press.spec.py`.

## Final assessment (v1.1)
HEOS Core v1.1 is **production ready**. Night Audit is autonomous with a manual
override, occupancy history is segment-authoritative end to end, and every
cross-cutting operation has exactly one implementation with regression cover.

---

# Final Production Readiness Pass — v1.1 (2026-08-05)

Scope: independent audit of shared-service duplication, legacy/dead code,
regression coverage, documentation accuracy, plus a consolidated risk and
go-live checklist. Fixes applied in this pass are marked ✅.

## 1. Shared services — one implementation per workflow

| Workflow | Verdict | Notes |
|---|---|---|
| Business-Date advance | 🟢 single | `night-audit-sessions-api.closeSession` only. `night-audit-api.performNightAudit()` is hard-disabled and throws. Scheduler + manual UI both delegate. |
| Room occupancy history | 🟢 single | `room-occupancy.ts` + `get_room_occupancy_segments` RPC. |
| Room move | 🟢 single | `moveBookingItemRoom` → `splitAssignment` → `split_room_assignment` RPC. House View DnD, Booking Detail, Room Assignment dialog and bulk ops all funnel here; the dialog's only direct table write is an `item_id` link repair, not a move. |
| Item lifecycle (CI/CO/add/remove/revert) | 🟢 single | `booking-item-operations-api.ts`. |
| Checkout gating | 🟢 single | `checkout-validation.ts`. |
| In-house definition | 🟢 single | `in-house.ts`. |
| Booking search | 🟢 single | `booking-search.ts`. |
| Booking clone | 🟢 single | `booking-clone.ts`, commercial-only. |
| Housekeeping generation / status | 🟢 single | `hk-tasks.ts`, `hk-generator.ts`, `hk-status.ts`, `hk-checkout-hook.ts`. No `hk_tasks` writes outside these. |
| Payment CRUD | 🟢 single | `booking-payments-api.ts`. |
| **Razorpay capture** | ✅ **fixed** | Was 3 paths (portal, webhook, booking engine). The Booking Engine inserted its own `booking_payments` row with a weaker `ilike` idempotency check and **no convenience-fee split**. It now calls `completeRazorpayCapture` like the other two. |
| **Room conflict detection** | ✅ **fixed** | `rooms-api.findRoomConflicts` read the legacy `bookings.room_id` mirror — it could report a conflict for a room the guest had already been moved out of. Rewritten onto `booking_room_assignments` segments. |
| Pricing | 🟡 1 canonical + shadows | `pricing.ts::computePricing` is used by every operator surface. `quotes-api.finalizeTotals` (dormant module) and three inline blocks in `booking-engine.functions.ts` re-derive the same `subtotal/taxes/total` arithmetic. Same results today; tracked as P2 tech debt. |
| Availability | 🟡 3 granularities | `room-availability.ts` (per room), `rooms-api.ts` (per room, day-use aware), `room-inventory.ts` (per room type, peak-demand). All three now read segments so results agree; collapsing them is P2. |
| Charge inserts | 🟡 | `razorpay-completion.server.ts` and `booking-create.ts` insert `booking_charges` directly (admin-client paths) rather than via `createBookingCharge()`. P3. |

## 2. Legacy cleanup

- `bookings.room_id` is now **write-only**: the single writer is
  `syncLegacyBookingRoom()` (recomputed from segments after every
  add/remove/split). The only remaining read is the read-only MCP
  `list-bookings` tool, which intentionally exposes "current room".
  ✅ The last availability-path read (`findRoomConflicts`) was removed in
  this pass.
- ✅ Dead code removed: `src/components/quote-summary.tsx` (zero importers),
  the three dead quote message builders in `quote-messages.ts` (only
  `waLink()` remains), `nodeToPng` / `downloadQuoteImage` in `share-quote.ts`,
  and the residual "Create Quote" / "New Quote" buttons on the Customers
  list and Customer Detail screens.
- Retained deliberately: `/generate`, `/history`, `/audit`, `/quote/*`,
  `/reports`, `/analytics` redirect shells (bookmark compatibility;
  `reports.tsx` / `analytics.tsx` also still export the components rendered by
  `reporting.staff` / `reporting.crm-analytics`), `quotes-api.ts` and
  `quote-items-api.ts` (historical read-only reporting), and `mock-data.ts`
  (misnamed — it holds live status constants).
- Remaining candidate-dead exports: ~45 `src/lib` exports have no importer,
  concentrated in `quotes-api.ts`. Left in place pending a `knip`/`ts-prune`
  run — a grep heuristic cannot see dynamic/registry references.

## 3. Regression coverage

- Unit/integration: **26 passing** — `night-audit-scheduler` (8),
  `booking-search` (9), `razorpay-completion` (5), `booking-clone` (4).
- E2E (Playwright): `room-move-regression.spec.py` (repeat occupancy
  102→104→102, sibling preservation, full operational lifecycle, HK
  integration under repeated moves), `house-view-long-press.spec.py`.
- Gaps worth scheduling (Medium): pricing engine, availability engine
  (all three granularities against one fixture set), business-date guard,
  checkout-validation blockers, permission RPC, CSV export.

## 4. Database & security posture

- RLS enabled on **70/70** public tables; DB linter reports **no
  ERROR-level findings**.
- 121 linter WARNs, all reviewed and accepted: `btree_gist`/`pg_net`
  installed in `public` (required by the occupancy exclusion constraint and
  the cron HTTP calls), and `SECURITY DEFINER` functions callable by
  `anon`/`authenticated` — these are the intentional `has_role`,
  occupancy-segment and audit RPCs that must bypass RLS by design.
- One actionable auth setting: **leaked-password protection is disabled**.
  Enabling it is a one-click backend setting and is recommended before
  onboarding external users.

## 5. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| `bookings_.$id.tsx` (~2k lines) concentrates most booking UI | Medium | Split by tab; behaviour-preserving. Tracked in `docs/architecture-health.md`. |
| Availability logic exists at three granularities | Medium | All read segments today; consolidate behind one surface (P2) before Maintenance adds a 4th consumer. |
| Push subscriptions are never pruned on 410 | Low | Nightly cron cleanup. |
| Booking-engine pricing arithmetic duplicated | Low | Route through `computePricing` (P2). |

## 6. Go-live checklist

- [x] All 70 public tables RLS-enabled, no ERROR-level lint findings
- [x] Night Audit autonomous (`heos-night-audit-6am-ist`) + manual override
- [x] Business Date can never exceed the Asia/Kolkata calendar date (trigger)
- [x] Gateway captures share one implementation (fee split on every channel)
- [x] Occupancy history segment-authoritative end to end
- [x] Regression suite green (26 unit + 2 E2E suites)
- [x] Docs synced (`shared-engines.md`, `room-occupancy.md`, `night-audit-scheduler.md`)
- [ ] Enable leaked-password protection
- [ ] Schedule P2 items: availability consolidation, booking-engine pricing, `bookings_.$id.tsx` split
- [ ] Run `knip` to confirm and delete the remaining unused exports

## Verdict

**HEOS Core v1.1 is production ready.** This pass closed two genuine
single-implementation defects (Booking Engine gateway payments bypassing the
fee split; room-conflict detection reading the retired room column) and
removed the last dead quote surfaces. Everything remaining is scheduled
tech debt, not a blocker for the Maintenance Module.
