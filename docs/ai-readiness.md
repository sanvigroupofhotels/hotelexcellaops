# HEOS → Excella AI OS — AI Readiness Reference

_Documentation only. Produced during HEOS v1.0 Shipment 3 (2026-07-09) to
prepare the platform for the upcoming Excella AI OS layer. No runtime
behaviour is implied by this document — it catalogues what exists so future
AI agents, automations, copilots, and dashboards can consume HEOS without
re-deriving domain knowledge._

---

## 1. Major business events

HEOS today emits its operational history via three durable event surfaces:

| Surface                          | What it records                                                                 | Table(s)                                                                              |
|----------------------------------|---------------------------------------------------------------------------------|---------------------------------------------------------------------------------------|
| Global activity log              | Cross-module, human-readable events                                             | `activity_log`                                                                        |
| Per-record activity trails       | Domain-scoped, typed events                                                     | `booking_activities`, `booking_payment_activities`, `complaint_activities`, `cash_tx_activities`, `cash_audit_activities`, `lead_activities`, `quote_activities` (deprecated) |
| Notifications                    | User-visible triggers routed to inbox / push / email                            | `notifications`                                                                       |

### Canonical event catalogue

These are the business events the platform already produces or trivially can
produce (all emissions today are synchronous writes; there is no external bus).

**Bookings**
- `BookingCreated` — direct or from the Booking Engine
- `BookingUpdated` — details, stay, notes
- `BookingStayExtended` — trigger: HK `continue_service` task auto-generated
- `BookingRoomChanged` — trigger: HK `deep_clean` on source room
- `GuestCheckedIn`
- `GuestCheckedOut` — trigger: HK `cleaning` task auto-generated
- `BookingCancelled`
- `BookingConverted` — Booking Engine → confirmed

**Payments & Cash**
- `PaymentReceived`, `PaymentReversed`, `PaymentLinkSent`
- `CashTransactionRecorded` (in/out), `CashAuditClosed`

**Housekeeping**
- `HKTaskGenerated`, `HKTaskAssigned`, `HKTaskCompleted`, `HKTaskSkipped`
- `RoomStatusChanged` (Clean / Dirty / Servicing / Out of Order)

**Laundry**
- `LinenQueued`, `BatchDispatched`, `BatchReturned`, `LinenDamaged`, `LinenLost`

**Inventory & Vendors**
- `InventoryItemLow` (derivable from movements + threshold)
- `InventoryMovement` (in/out/adjust), `VendorInvoiceRecorded`

**Night Audit & Business Date**
- `NightAuditStarted`, `NightAuditCompleted`, `BusinessDateAdvanced`
- `NightAuditPending` (blocking condition — surfaces to Ops)

**Guest Portal**
- `PortalOpened`, `IDDocumentUploaded`, `PortalPaymentInitiated`, `PortalCancellationRequested`, `GuestReviewSubmitted`

**CRM / Marketing**
- `LeadCaptured`, `LeadConverted`, `PromoCodeApplied`

**Complaints**
- `ComplaintFiled`, `ComplaintAssigned`, `ComplaintResolved`

---

## 2. Shared engines (safe to consume from AI)

| Engine                                | File                                          | Role                                                                    |
|---------------------------------------|-----------------------------------------------|-------------------------------------------------------------------------|
| Pricing engine                        | `src/lib/pricing.ts`                          | Single source of truth for all room / add-on pricing math.              |
| Booking stay mutations                | `src/lib/booking-stay.ts`                     | Only entry point for stay changes; triggers HK side-effects.            |
| HK task generator                     | `src/lib/hk-generator.ts` + `hk-checkout-hook.ts` | Idempotent HK task creation from booking lifecycle events.          |
| Night Audit engine                    | `src/lib/night-audit-sessions-api.ts` (`closeSession`) | Single source of truth for BD advance + blocking validation.        |
| Payment link / message engine         | `src/lib/booking-messages.ts` (`paymentLinkMessage`) | Unified WhatsApp / share text.                                        |
| Reporting aggregation                 | `src/lib/reporting/*`                         | Date-range-scoped, RLS-respecting aggregation queries.                  |
| Notification routing                  | `src/lib/notification-routing.ts` + `notification-engine.ts` | Deterministic recipient resolution + fan-out.                 |
| Cash report engine                    | `src/lib/cash-report.ts`                      | Day / category / staff summaries; used by ops and reports.              |
| Room availability                     | `src/lib/room-availability.ts`                | Booking Engine + operator ops share the same availability calc.         |
| Permissions (RBAC)                    | `has_role`, `my_permissions`, `user_effective_permissions` RPCs | RLS-safe permission derivation.                        |

**Rule for AI consumers:** never re-derive any of the above; call the engine
or read its outputs. Divergent AI calculations are the single biggest risk to
consistency across HEOS and Excella AI OS.

---

## 3. Recommended integration points

### 3.1 AI Copilots (per-department suggestions)
- **Front Office copilot** — reads: bookings, room availability, guest portal state, complaints. Writes: draft messages (never direct send), suggested actions (`extend`, `move room`, `apply promo`).
- **Housekeeping copilot** — reads: `housekeeping_tasks`, occupancy forecast. Writes: task priority hints, staff-load rebalancing suggestions.
- **Revenue copilot** — reads: bookings + pricing + occupancy. Writes: rate override proposals into `rate_overrides` (approval-gated).
- **Finance copilot** — reads: `cash_transactions`, `booking_payments`, dues. Writes: reconciliation flags into notifications.

### 3.2 Automation Engine trigger points
Attach automations to the events in §1. High-value candidates:
- `BookingCreated` → payment link auto-send after N minutes
- `GuestCheckedIn` → wifi credentials / welcome message via Portal
- `PaymentReceived (>threshold)` → immediate finance notification
- `HKTaskGenerated (deep_clean)` → auto-assign based on shift roster
- `InventoryItemLow` → draft vendor purchase order
- `NightAuditPending` → escalation ladder (assignee → supervisor → owner)
- `BookingStayExtended (past BD)` → verify HK `continue_service` created (safety net)

### 3.3 Approval workflows
Candidates that should not run autonomously:
- Rate overrides beyond a % threshold
- Refunds / payment reversals
- Room block / OOO for > 24h
- Manual overrides on Night Audit
- Deleting complaints, bookings, or customer records

### 3.4 Executive dashboards / analytics
Primary data sources for future Owner AI OS dashboards:
- Occupancy & ADR → `bookings`, `booking_items`, `room_rates`
- Revenue → `booking_payments`, `booking_charges`, `cash_transactions`
- Ops KPIs → `housekeeping_tasks` (SLA), `complaints` (resolution time), `laundry_batches` (turnaround)
- Guest satisfaction → `guest_reviews`, complaint counts
- Cash flow → `cash_audit_closes`, `cash_transactions`

### 3.5 Notifications & messaging
The notification engine is the recommended output channel for any AI action
that needs human awareness — it already handles routing, permissions, push,
email, and read-state.

### 3.6 Department AI opportunities
- **Operations**: shift-optimized HK task assignment; predictive laundry batch sizing.
- **Finance**: cash-close variance flagging; dues collection prioritization.
- **Inventory**: low-stock prediction from movement velocity; vendor lead-time learning.
- **Marketing / CRM**: lead scoring from portal engagement + booking history; churn detection.
- **Revenue Management**: dynamic pricing suggestions (approval-gated); occupancy forecasting.
- **Guest Experience**: proactive complaint resolution from portal signals; upsell targeting (early CI / late CO / pet stay).

---

## 4. What to expose vs. what to guard

**Safe for AI consumption (read):** activity_log, notifications, bookings,
housekeeping_tasks, laundry_batches, cash_transactions, guest_reviews,
complaints, inventory_movements, night_audit_sessions.

**Guard behind approvals (write):** rate_overrides, booking_payments,
booking cancellations, user_roles, role_permissions, app_settings
(business_date especially), master_data.

**Never expose to AI directly:** raw auth tokens, staff PII beyond
operational fields, service-role writes to `user_roles` /
`role_permissions`. The `has_role` + `user_effective_permissions` RPCs are
the correct authorization surface.

---

## 5. Open items before Excella AI OS
- No external event bus today — events live in tables; a lightweight
  outbox pattern (or Postgres NOTIFY / logical replication) will be needed
  when AI agents run out-of-process.
- No idempotency keys on user-facing writes — needed before AI can safely
  retry.
- No explicit "AI action" audit surface — activity_log rows will need an
  `actor_type` (`user` / `ai_agent` / `automation`) to differentiate.
