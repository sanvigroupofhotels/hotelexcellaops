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
