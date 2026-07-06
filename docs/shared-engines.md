# HEOS Shared Engines — Ownership Map

_Last reviewed: 2026-07-05 (P1 stabilization sprint)_

Every domain in HEOS is owned by exactly one "engine" — a small,
well-scoped module that owns the schema, business rules, activity
logging and public API for that domain. Before adding new logic to a
screen, check this map: **if an engine already owns the behavior, extend
the engine rather than duplicating logic in the screen.**

## Engines

| Engine | Owns | Canonical files | Consumers |
|--------|------|-----------------|-----------|
| **Booking** | Booking lifecycle, statuses, room assignment, conflict checks | `booking-status.ts`, `booking-create.ts`, `bookings-api.ts`, `booking-stay.ts`, `booking-room-assignments-api.ts`, `booking-engine.functions.ts` | Bookings (Detailed + Quick), Calendar, House View, Portal, Booking Engine |
| **Pricing** | Nights × rate + taxes + discount + override math, resolved via `computePricing` | `pricing.ts`, `rates.ts`, `rates-api.ts`, `pricing-breakdown.tsx`, `quote-summary.tsx`, `resolved-rate.ts` | Quotes, Bookings, Invoices, Portal, Booking Engine, WhatsApp share |
| **Customer / CRM** | Customer master, phone-based resolution, lead pipeline | `customers-api.ts`, `customer-resolution.ts`, `leads.functions.ts`, `phone.ts` | Bookings, Portal, Follow-ups, Complaints |
| **Payment** | Booking payments, refunds, Razorpay + cash sync | `booking-payments-api.ts`, `booking-payment-activities-api.ts`, `app-settings-api.ts` (payment settings), `payment-ocr.functions.ts`, `payment-settings-section.tsx` | Bookings, Cash, Portal |
| **Cash** | Cash book, cash audit close, cash reports | `cash-api.ts`, `cash-audit-api.ts`, `cash-report.ts` | Cash screens, Payments Reports |
| **Housekeeping** | Task lifecycle (checkout / service / DND / not-required), exceptions, checkout hook | `hk-tasks.ts`, `hk-generator.ts`, `hk-checkout-hook.ts`, `hk-status.ts`, `hk-issue-types-api.ts` | Housekeeping, HK Reporting, Night Audit, House View |
| **Laundry** | Queue, batches, vendor turnaround, in-house | `laundry-queue-api.ts`, `laundry-batches-api.ts`, `linen-master-api.ts` | Laundry screen, Laundry Reporting, HK completion |
| **Inventory** | Stock, movements, charge-catalog consumption | `inventory-items-api.ts`, `inventory-movements.ts`, `charge-catalog-api.ts` | Housekeeping, Bookings (charges), Reporting |
| **Vendor** | Vendor master + kind[] tagging | `vendors-api.ts` | Laundry, Complaints, Maintenance (planned), Inventory |
| **Complaint** | Complaint categories + status pipeline | `complaints-api.ts`, `hk-issue-types-api.ts` (mapping) | Complaints, HK issues, Maintenance (planned) |
| **Notification** | Push + email dispatch + notification rows | `notifications-api.ts`, `notification-engine.ts`, `notification-routing.ts`, `push-subscriptions.functions.ts`, `push-admin.functions.ts` | All modules that emit events |
| **Activity Log** | Universal audit trail | `activity-log.ts` | Every module |
| **Access / Roles** | Roles, permissions, per-user overrides | `access-api.ts`, `use-role.ts`, `use-permissions.ts`, `users-admin.functions.ts` | User Management, Role Management, Access Management, `PermissionGate` |
| **Night Audit** | Business date, EOD, sweeps, sessions | `night-audit-api.ts`, `night-audit-sessions-api.ts`, `perform-night-audit.ts` | Night Audit screens, HK generation, `/api/public/night-audit` |
| **Analytics / Reporting** | Aggregation helpers reading operational snapshots — **no business logic** | `reporting/date-range.ts`, `reporting/hk-reporting.ts`, `reporting/laundry-reporting.ts`, `kpi-defs.ts`, `owner-dashboard.functions.ts` | All Reporting routes |
| **Master Data** | Small enumerations (lead sources, complaint categories, etc.) | `master-data-api.ts`, `use-master-data.ts` | Bookings, Quotes, Complaints |
| **Business Date** | Single hotel-day clock (Asia/Kolkata) | `night-audit-api.ts` `getBusinessDate()`, `app_settings_guard_business_date` trigger | HK, Laundry, Reporting, NA, Payments |
| **Guest Documents** | ID docs, secure storage, retention | `guest-documents-api.ts`, `guest-documents-dialog.tsx` | Bookings, Customers, Portal |

## Rules

1. **Screens never own business logic.** A route file may compose engines
   and render UI. If it starts to compute pricing, resolve customers,
   move inventory, or fanout events on its own, extract into the owning
   engine.
2. **No duplicate resolvers.** Every domain has exactly one entry point
   for its side-effecting operations. Search here first.
3. **Reporting reads only.** The `reporting/*` engine aggregates
   operational snapshots; it never writes.
4. **Activity Log is the event bus.** New engines must emit
   `logActivity` on every state-changing operation.
5. **Business Date is the clock.** Any date-scoped work (reports,
   HK generation, laundry, cash audit) must resolve `today` via
   `getBusinessDate()`, not `new Date()`.

## Recent Consolidations (2026-07-05)

- **Pricing** — `PricingBreakdownCard` now shared by Quotes, Bookings
  (Detailed + Quick), Invoices, Portal, WhatsApp. `totalOverride` and
  `taxesIncluded` semantics unified.
- **Reporting** — introduced `src/lib/reporting/*` shared engine and
  `ReportDateRangePicker` component; used by both HK and Laundry
  reporting.
- **Laundry** — `create_laundry_batch` and `confirm_laundry_return`
  moved to atomic RPCs.
- **Access** — role model collapsed to four active roles
  (admin / owner / fo_staff / housekeeping). Legacy `reception` and
  `staff` enum values are hidden from every UI surface and coerced to
  their modern equivalents at read time.

## Future Consolidations Tracked in Backlog

- **Booking Conflict Engine** (P2) — unify piecemeal checks in
  `room-availability.ts` and `blocks-api.ts` behind an assignment-time
  surface.
- **Operational Rules Engine** (P2 architectural) — consolidate
  scattered event → effect rules once Maintenance adds the 5th rule.
- **Booking-list filtering** (P3 tech-debt) — consolidate between
  `bookings.tsx` and `calendar.tsx` into `booking-status.ts`.
