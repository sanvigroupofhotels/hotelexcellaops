# HEOS Core v1.0 — System Architecture

> Baseline document. Post-v1.0 work should **extend** these constructs, not
> redesign them. Every architectural exception must be justified in a PR
> description and recorded in `docs/architecture-health.md`.

## 1. High-level shape

```
┌──────────────────────────────────────────────────────────────┐
│                       Browser / PWA                          │
│  Ops app (auth)  │  Booking Engine (public)  │ Guest Portal  │
└──────────────────────────────────────────────────────────────┘
                            │
                            │  TanStack Router (file-based)
                            │  ─ pages under src/routes/
                            │  ─ /api/public/* raw HTTP routes
                            ▼
┌──────────────────────────────────────────────────────────────┐
│              TanStack Start runtime (Cloudflare Worker)      │
│                                                              │
│  createServerFn (typed RPC)   │   Server routes /api/public  │
│  ─ requireSupabaseAuth mw     │   ─ webhooks, cron, portal   │
│  ─ shared engines (src/lib)   │   ─ signature-verified       │
└──────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────┐
│                    Supabase (Lovable Cloud)                  │
│  Postgres · RLS · triggers · pg_cron  │  Auth  │  Storage    │
└──────────────────────────────────────────────────────────────┘
```

## 2. Module boundaries

Each operational surface owns a **thin route file** and delegates business
logic to a **shared engine**. Routes never talk to Supabase for anything
beyond simple list/read queries — every write, every state transition, and
every cross-module effect flows through an engine.

| Module              | Route folder             | Primary engines (src/lib)                   |
|---------------------|--------------------------|---------------------------------------------|
| Booking             | `_authenticated/bookings*`, `bookings_.$id.tsx`, `booking-engine.*` | `booking-*`, `pricing.ts`, `booking-stay.ts` |
| Guest Portal        | `portal.$token.tsx`      | `portal.functions.ts`, `booking-messages.ts` |
| House View          | `house-view.tsx`         | `room-inventory.ts`, `room-counts.ts`        |
| Housekeeping        | `housekeeping.tsx`, `operations.*` | `hk-*`, `laundry-*`                |
| Laundry             | `laundry.tsx`            | `laundry-*`                                  |
| Cash Book           | `cash.tsx`               | `cash-api.ts`, `cash-audit-api.ts`           |
| Night Audit         | `night-audit.*`          | `night-audit-*`, `perform-night-audit.ts`    |
| Reporting           | `reporting.*`            | `reporting/*`, `owner-dashboard.functions.ts`|
| Master Data         | `master-data.tsx`        | `master-data-api.ts`, `charge-catalog-api.ts`|
| Users / Access      | `users.*`                | `users-admin.functions.ts`, `access-api.ts`  |
| Staff Management    | `staff-management.*`     | `staff-hr-api.ts`, `staff-documents-api.ts`  |
| Complaints          | `complaints*.tsx`        | `complaints-api.ts`                          |
| Notifications       | (cross-cutting)          | `notification-engine.ts`, `notifications-api.ts` |

## 3. Layer responsibilities

1. **Routes (`src/routes/**`)**
   Composition only: layout, data hooks, event handlers. No SQL, no cross-
   module orchestration, no business rules.
2. **Engines (`src/lib/*`)**
   Pure business logic + Supabase I/O. Idempotent, transactional where
   possible, always emit activity log entries for state transitions.
3. **Server functions (`*.functions.ts`)**
   Anything requiring elevated privilege or authenticated server-side
   execution (auth-admin, webhooks, portal token exchange, OCR, etc.).
   Import protection: never expose service-role side effects to the client.
4. **Database (`supabase/migrations`)**
   Schema, RLS, triggers, `pg_cron`, security-definer helpers
   (`has_role`, `is_admin`, `is_business_date_before_today`, etc.).
   Migrations are the only source of truth for policy and structure.

## 4. Shared-engine philosophy

- **One engine per business concept.** Booking, Pricing, Housekeeping,
  Laundry, Cash, Night Audit, Notifications each own their invariants.
- **Consumers never duplicate write logic.** If a screen wants a side
  effect (e.g. "on checkout, generate HK task"), it calls the engine hook
  (`hk-checkout-hook.ts`), never the raw table.
- **Events over coupling.** State changes emit rows into
  `activity_log` / `booking_activities` / `notifications`. New consumers
  (notifications, AI agents, integrations) subscribe to these events
  rather than being wired into every callsite.
- **RLS is the security floor.** Engines assume RLS enforces role and
  ownership. Application-level permission checks (`has`, `hasAny`) are UX
  guardrails, not the security perimeter.

## 5. Design principles

1. **Single source of truth per entity.** One customer record, one
   booking record, one HK task per (booking, room, day). Duplicate paths
   are refactored on sight.
2. **Idempotent operations.** Every engine handler tolerates being called
   twice with the same payload (double-tap, retry, replay).
3. **Business Date is authoritative.** All operational filters and
   reports pivot on `app_settings.business_date`, not `now()`. See
   `docs/workflows.md` § Business Date Lifecycle.
4. **Server functions read env at handler time.** Never at module scope —
   env injection happens at call time in the Worker.
5. **Never edit generated files** (`src/routeTree.gen.ts`,
   `src/integrations/supabase/{client,types,auth-*}`). Migrations
   regenerate types automatically.

## 6. Architectural decisions (v1.0)

| Decision | Rationale | Reference |
|---|---|---|
| Consolidate Booking ↔ HK integration behind `hk-checkout-hook.ts` | Removes duplicate task-creation code paths across 4 screens | Shipment 1 |
| Unify payment-link generation in Razorpay engine | Guest Portal and Ops share the same order lifecycle | Shipment 1 |
| Deprecate Quotes, keep tables dormant | Preserve historical audit trail without carrying dead UI | Shipment 3 |
| Roles = `owner`, `admin`, `fo_staff`, `housekeeping` | `reception`/`staff` replaced; trigger blocks new writes | Shipment 3 |
| Permissions live in DB (`permissions`, `role_permissions`, `user_permission_overrides`) | Runtime editable, auditable, decoupled from code | v0.9 → v1.0 |
| Business Date guarded by trigger, never exceeds calendar date | Correctness across time-zone edges | v1.0 |
| `/api/public/*` for webhooks + cron only, always signature-verified | Only bypass auth for callers we can authenticate cryptographically | v1.0 |

## 7. Future extension principles

- **New module?** Create a new engine file in `src/lib/`, a route folder,
  and one migration for the tables + RLS + grants. Follow existing
  naming.
- **New cross-module effect?** Emit an event/activity row and consume it
  from the target engine — do not wire the source screen directly.
- **New notification channel?** Register an adapter in the notification
  engine (`docs/notification-architecture.md`). No screen changes.
- **New AI agent?** Read via existing engine functions, propose writes
  through approval workflows (`docs/ai-roadmap.md`). Never bypass RLS.
- **New table?** Migration must include GRANT + RLS + policies + an
  entry in `docs/database.md`.
