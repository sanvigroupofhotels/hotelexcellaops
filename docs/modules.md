# HEOS Core v1.0 — Modules

Every operational module. For each: purpose, responsibilities, features,
dependencies, shared engines, database tables, permissions, reports,
public APIs, extension points.

Legend for tables: `[R]` read-only, `[W]` write, `[EVT]` emits events.

---

## 1. Booking

**Purpose.** Manage the full booking lifecycle from lead to checkout.

**Responsibilities.** Room selection · rate resolution · guest capture ·
deposit/payment · check-in · in-house charges · room change · extension ·
checkout · cancellation.

**Features.**
- Ops-side booking creation (`bookings_.new.tsx`) and edit
  (`bookings_.$id_.edit.tsx`).
- Public Booking Engine (`booking-engine.*`) — search, review, checkout,
  confirmation with Razorpay.
- Quick booking flow for walk-ins (`bookings_.quick.tsx`).
- Room assignment (single or multi-room) with block-aware availability.
- Business-Date-aware occupancy in House View.

**Dependencies.** Customer, Master Data (lead source, tags), Rates,
Rooms, Cash Book (deposits), Housekeeping (checkout hook), Notifications.

**Shared engines.** `booking-create.ts`, `bookings-api.ts`,
`booking-stay.ts`, `booking-charges-api.ts`, `booking-payments-api.ts`,
`booking-room-assignments-api.ts`, `booking-status.ts`, `pricing.ts`,
`room-availability.ts`, `hk-checkout-hook.ts`.

**Tables [W].** `bookings`, `booking_items`, `booking_charges`,
`booking_payments`, `booking_payment_activities`,
`booking_room_assignments`, `booking_activities`, `booking_tokens`,
`external_bookings`, `razorpay_orders`, `razorpay_webhook_events`,
`leads`, `lead_activities`, `promo_codes`.

**Permissions.** `bookings.view`, `bookings.create`, `bookings.edit`,
`bookings.checkin`, `bookings.checkout`, `bookings.cancel`,
`bookings.refund`, `dues.view`.

**Reports.** Occupancy, ADR, RevPAR, Owner Dashboard, CRM Analytics,
Payment Reports, Dues.

**Public APIs.** `/api/public/razorpay-webhook`,
`/api/public/hotelzify-poll`.

**Extension points.** Emit `booking_activities` rows for new consumers.
Add channel adapters via notification engine. Never mutate booking state
outside `booking-*` engines.

---

## 2. Guest Portal

**Purpose.** Public per-booking self-service surface via signed token.

**Responsibilities.** Booking summary · pay balance · upload documents ·
request extension · request room change · view receipts.

**Features.** Token-scoped access · Razorpay payment · document upload
with retention policy · WhatsApp deep-link.

**Dependencies.** Booking, Payments, Guest Documents, Notifications.

**Shared engines.** `portal.functions.ts`, `booking-messages.ts`,
`guest-documents-api.ts`.

**Tables [R/W].** `bookings [R]`, `booking_payments [W]`,
`booking_charges [R]`, `booking_room_assignments [R]`,
`guest_documents [W]`, `booking_tokens [R]`.

**Permissions.** Public route; auth via signed token. Ops surfaces
gated by `guest_portal.ops_view`.

**Public APIs.** `/portal/$token` (page), `/api/public/razorpay-webhook`
(shared), `/api/public/cleanup-guest-documents` (cron).

**Extension points.** New guest-facing cards register in the portal
route; new comms channels via notification engine.

---

## 3. House View

**Purpose.** Live grid of every room's current state.

**Responsibilities.** Occupancy · HK status · block state · deep-links
to booking, HK, and block dialogs.

**Features.** Long-press debug overlay (dev), Business-Date-aware, real-
time room-status updates via realtime subscriptions.

**Dependencies.** Booking, Housekeeping, Blocks.

**Shared engines.** `room-inventory.ts`, `room-counts.ts`,
`blocks-api.ts`, `hk-status.ts`.

**Tables [R].** `rooms`, `bookings`, `booking_room_assignments`,
`housekeeping_tasks`, `room_maintenance`.

**Permissions.** `house_view.view`.

**Reports.** Occupancy Summary (shared with Owner Dashboard).

**Extension points.** Room-card badges/actions; realtime channels.

---

## 4. Housekeeping

**Purpose.** Daily HK task lifecycle and room readiness.

**Responsibilities.** Task generation on checkout · manual/service tasks
· claim/complete · issue reporting · linen linkage to laundry.

**Features.** Housekeeper self-service board · working-as override for
supervisors · issue types master · work history reporting.

**Dependencies.** Booking (checkout hook), Laundry, Master Data.

**Shared engines.** `hk-tasks.ts`, `hk-generator.ts`,
`hk-checkout-hook.ts`, `hk-status.ts`, `hk-issue-types-api.ts`,
`linen-master-api.ts`.

**Tables [W].** `housekeeping_tasks`, `housekeeping_room_exceptions`,
`hk_issue_types`, `linen_types`.

**Permissions.** `housekeeping.view`, `housekeeping.work`.

**Reports.** HK productivity, issues by type, per-staff throughput
(`reporting.housekeeping.tsx`).

**Extension points.** New task types via `hk-tasks.ts`; new issue types
in master data.

---

## 5. Laundry

**Purpose.** Batch-based linen laundry lifecycle.

**Responsibilities.** Queue management · batch creation · vendor
dispatch · returned/damaged/lost accounting.

**Features.** HK completion → laundry queue auto-population · vendor
selection · linen master · full audit trail.

**Dependencies.** Housekeeping, Vendors, Linen Types.

**Shared engines.** `laundry-batches-api.ts`, `laundry-queue-api.ts`,
`reporting/laundry-reporting.ts`.

**Tables [W].** `laundry_batches`, `laundry_batch_lines`, `laundry_queue`.

**Permissions.** `laundry.view`, `laundry.manage`.

**Reports.** Turnaround, vendor performance, loss/damage
(`reporting.laundry.tsx`).

**Extension points.** New batch states, new vendor integrations.

---

## 6. Cash Book

**Purpose.** Daily cash-in/out ledger with audit close.

**Responsibilities.** Booking receipts · expense entries · cash close ·
reconciliation.

**Features.** Business-Date scoped · expense-type master · daily and
per-user audit close · immutable audit log.

**Dependencies.** Booking (payments), Master Data (expense types),
Business Date.

**Shared engines.** `cash-api.ts`, `cash-audit-api.ts`,
`cash-report.ts`.

**Tables [W].** `cash_transactions`, `cash_tx_activities`,
`cash_audit_closes`, `cash_audit_activities`, `expense_types`.

**Permissions.** `cash.view`.

**Reports.** Daily Cash Book, expense breakdown, close ledger.

**Extension points.** New transaction categories; export adapters.

---

## 7. Night Audit

**Purpose.** End-of-day close: verify state, advance Business Date.

**Responsibilities.** Critical task list · EOD report · session logging
· business date advance.

**Features.** Pending-count badge · full checklist gating · immutable
session ledger.

**Dependencies.** Every operational module (checks their EOD state).

**Shared engines.** `night-audit-api.ts`, `night-audit-sessions-api.ts`,
`perform-night-audit.ts`.

**Tables [W].** `night_audit_runs`, `night_audit_sessions`,
`night_audit_decisions`, `app_settings` (business_date).

**Permissions.** `night_audit.run`, `reporting.night_audit.view`.

**Reports.** Audit history, EOD report, decisions log.

**Public APIs.** `/api/public/night-audit` (cron/health).

**Extension points.** New pre-close checks register in
`perform-night-audit.ts` orchestrator.

---

## 8. Reporting

**Purpose.** Read-only analytics across all modules.

**Responsibilities.** Owner Dashboard · CRM Analytics · Payments · HK ·
Laundry · Staff · Activity · Night Audit history.

**Shared engines.** `reporting/date-range.ts`, `reporting/hk-reporting.ts`,
`reporting/laundry-reporting.ts`, `owner-dashboard.functions.ts`.

**Tables [R].** All operational tables + `activity_log`.

**Permissions.** `reporting.analytics.view`,
`reporting.payments.view`, `reporting.housekeeping.view`,
`reporting.laundry.view`, `reporting.staff.view`,
`reporting.night_audit.view`.

**Extension points.** New reports register as leaf routes under
`reporting.*.tsx`; reuse `date-range.ts` for consistent filters.

---

## 9. User & Access Management

**Purpose.** Manage user accounts, role assignment, permission overrides.

**Responsibilities.** Invite/deactivate users · assign roles · edit
per-user permission overrides.

**Shared engines.** `users-admin.functions.ts`, `access-api.ts`.

**Tables [W].** `profiles`, `user_roles`, `user_permission_overrides`,
`permissions`, `role_permissions`, `roles`.

**Permissions.** `users.manage_users`, `users.manage_roles`,
`users.manage_access`.

**Extension points.** New permission keys added via migration + entry
in `docs/permissions.md`.

---

## 10. Master Data

**Purpose.** Editable catalogs used across the app.

**Responsibilities.** Lead sources, tags, expense types, complaint
categories, linen types, HK issue types, in-house charge categories,
rooms, rates.

**Shared engines.** `master-data-api.ts`, `charge-catalog-api.ts`,
`rates-api.ts`, `rooms-api.ts`.

**Tables [W].** `master_data`, `charge_catalog`, `expense_types`,
`complaint_categories`, `linen_types`, `hk_issue_types`, `rooms`,
`room_rates`, `rate_overrides`.

**Permissions.** `master.rooms`, `master.rates`, `master.others`,
`operations.charge_catalog`, `operations.hk_issue_types`,
`operations.linen_types`.

**Extension points.** New categories via a single row in `master_data`;
new dedicated masters via new tables + engine.

---

## 11. Staff Management

**Purpose.** Staff HR: master, attendance, salary, ledger, documents.

**Shared engines.** `staff-hr-api.ts`, `staff-documents-api.ts`.

**Tables [W].** `staff`, `staff_attendance`, `salary_payments`,
`salary_advances`, `staff_documents`.

**Permissions.** `staff.master`, `staff.attendance`, `staff.salary`.

**Reports.** Attendance summary, salary ledger, staff productivity.

**Extension points.** New HR entities as new tables under `staff-*`.

---

## 12. Complaints

**Purpose.** Guest complaint intake and resolution tracking.

**Shared engines.** `complaints-api.ts`.

**Tables [W].** `complaints`, `complaint_activities`,
`complaint_categories`.

**Permissions.** `complaints.view`.

---

## 13. Customers (CRM)

**Purpose.** Unified customer record across bookings.

**Shared engines.** `customers-api.ts`, `customer-resolution.ts`.

**Tables [W].** `customers`, `guest_reviews`.

**Permissions.** `customers.view`.

**Reports.** CRM Analytics.

---

## 14. Inventory & Vendors

**Purpose.** Inventory items, movements, vendor master.

**Shared engines.** `inventory-items-api.ts`, `inventory-movements.ts`,
`vendors-api.ts`.

**Tables [W].** `inventory_items`, `inventory_movements`, `vendors`.

**Permissions.** `operations.inventory`, `operations.vendors`.

---

## 15. Notifications (cross-cutting)

**Purpose.** Central engine for in-app, push, and future email/WA.

**Shared engines.** `notification-engine.ts`, `notification-routing.ts`,
`notifications-api.ts`.

**Tables [W].** `notifications`, `push_subscriptions`,
`crm_outbound_emails`.

**Public APIs.** `/api/public/notification-email-dispatch`,
`/api/public/push-dispatch`.

**Extension points.** New audiences and channels — see
`docs/notification-architecture.md`.

---

## Deprecated (retained read-only)

- **Quotes / Follow-ups.** Tables `quotes`, `quote_items`,
  `quote_activities`, `followups` remain readable for audit. Write
  grants revoked. Legacy routes redirect to canonical equivalents.
