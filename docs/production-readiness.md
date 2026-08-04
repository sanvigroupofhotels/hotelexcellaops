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
