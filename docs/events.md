# HEOS v1.0 — Business Event Catalog

_Produced: 2026-07-09 (Shipment 3B). Documentation only — no runtime bus
today; events are emitted synchronously into `activity_log`, per-record
activity tables, and `notifications`. This catalog is the contract future
automation, notification, and AI agents will subscribe to._

## Event surfaces (where events live today)

| Surface                         | Table(s)                                                                                  |
|---------------------------------|-------------------------------------------------------------------------------------------|
| Global activity                 | `activity_log`                                                                            |
| Per-record trails               | `booking_activities`, `booking_payment_activities`, `complaint_activities`, `cash_tx_activities`, `cash_audit_activities`, `lead_activities` |
| Notifications (user-visible)    | `notifications`                                                                            |
| Domain state tables (implicit)  | `bookings`, `housekeeping_tasks`, `laundry_batches`, `night_audit_sessions`, `cash_transactions`, `inventory_movements` |

## Canonical event catalogue

### Booking
| Event                     | Emitter (module)                     | Notes |
|---------------------------|--------------------------------------|-------|
| BookingCreated            | `booking-create.ts`                  | Direct + Booking Engine |
| BookingUpdated            | `bookings-api.ts`                    | Details, notes, tariff |
| BookingConfirmed          | `booking-status.ts`                  | Status transition |
| BookingCancelled          | `booking-status.ts`                  | With reason/refund flag |
| BookingExtended           | `booking-stay.ts` (`updateBookingStay`) | Fires `HKContinueServiceTaskCreated` side-effect |
| BookingRoomChanged        | `booking-stay.ts`                    | Fires `HKDeepCleanTaskCreated` |
| GuestCheckedIn            | `check-in-flow.tsx`                  | |
| GuestCheckedOut          | `bookings-api.ts` / `hk-checkout-hook.ts` | Fires `HKCheckoutTaskCreated` |
| PaymentReceived           | `booking-payments-api.ts`            | Portal + operator |
| PaymentReversed / RefundIssued | `booking-payments-api.ts`       | |
| PaymentLinkSent           | `booking-messages.ts`                | |

### Housekeeping
| Event                      | Emitter                                 |
|----------------------------|-----------------------------------------|
| HKCheckoutTaskCreated      | `hk-checkout-hook.ts`                   |
| HKContinueServiceTaskCreated | `hk-generator.ts`                     |
| HKDeepCleanTaskCreated     | `hk-generator.ts`                       |
| HKManualTaskCreated        | `hk-tasks.ts`                           |
| HKTaskStarted              | `hk-tasks.ts` (status → `in_progress`)  |
| HKTaskCompleted            | `hk-tasks.ts`                           |
| HKTaskSkipped              | `hk-tasks.ts` (with reason)             |
| RoomReady / RoomDirty      | derived from HK task completion         |
| RoomNeedsService           | HK issue-type task w/ blocking flag     |
| RoomDND / ServiceNotRequired | HK status write from house-view       |

### Laundry
| Event                    | Emitter                                       |
|--------------------------|-----------------------------------------------|
| LinenPickupCreated       | `laundry-queue-api.ts`                        |
| BatchSent                | `laundry-batches-api.ts`                      |
| BatchReturned            | `laundry-batches-api.ts`                      |
| ReturnCorrected          | `laundry-batches-api.ts`                      |
| LinenDamaged / LinenLost | `laundry-batches-api.ts`                      |

### Inventory
| Event                    | Emitter                                       |
|--------------------------|-----------------------------------------------|
| InventoryMovement        | `inventory-movements.ts` (in/out/adjust)      |
| InventoryItemLow         | derivable: `on_hand < reorder_threshold`      |
| InventoryOutOfStock      | derivable: `on_hand <= 0`                     |
| PurchaseRequired         | manual flag on vendor order                   |

### Finance / Cash
| Event                    | Emitter                                       |
|--------------------------|-----------------------------------------------|
| CashIn / CashOut         | `cash-api.ts`                                 |
| VendorPaymentRecorded    | `cash-api.ts` (category=vendor)               |
| CashDailyClose           | `cash-audit-api.ts`                           |
| RevenueMilestoneCrossed  | derivable from `cash-report.ts` totals        |

### Guest / Portal
| Event                    | Emitter                                       |
|--------------------------|-----------------------------------------------|
| PortalOpened             | `portal.functions.ts`                         |
| IDDocumentUploaded       | `guest-documents-api.ts`                      |
| PortalPaymentInitiated   | `portal.functions.ts` + Razorpay              |
| PortalCancellationRequested | `portal.functions.ts`                      |
| GuestReviewSubmitted     | `portal.functions.ts`                         |
| FoodOrderPlaced / Delivered | future — not yet implemented               |

### Complaints
| Event                    | Emitter                                       |
|--------------------------|-----------------------------------------------|
| ComplaintFiled           | `complaints-api.ts`                           |
| ComplaintAssigned        | `complaints-api.ts`                           |
| ComplaintResolved        | `complaints-api.ts`                           |

### Night Audit / Business Date
| Event                    | Emitter                                       |
|--------------------------|-----------------------------------------------|
| NightAuditStarted        | `night-audit-sessions-api.ts` (`openSession`) |
| NightAuditCompleted      | `night-audit-sessions-api.ts` (`closeSession`)|
| BusinessDateAdvanced     | `closeSession` (single source of truth)       |
| NightAuditPending        | derivable — surfaces to Ops via badge/notif   |

### CRM / Marketing
| Event                    | Emitter                                       |
|--------------------------|-----------------------------------------------|
| LeadCaptured             | `leads.functions.ts`                          |
| LeadConverted            | `leads.functions.ts`                          |
| PromoCodeApplied         | booking creation path                         |

## Rules for future subscribers
1. Never re-derive engine outputs — subscribe to the event and read the
   engine's canonical state (`bookings.status`, `housekeeping_tasks.status`, etc.).
2. All writes flow through the shared engines listed in
   `docs/ai-readiness.md §2`; automations must call those engines, not
   raw table mutations.
3. When an event needs to fan out (WhatsApp / email / push / AI), route
   through `notification-engine.ts` — never couple the emitting module
   to a specific transport.

## Migration path to an event bus
- Add `actor_type` (`user` / `automation` / `ai_agent`) to `activity_log`.
- Introduce an `outbox` table populated in the same transaction as the
  domain write; a worker relays to Postgres NOTIFY or an external bus.
- Idempotency keys on user-facing writes so AI retries are safe.

None of the above blocks HEOS v1.0 sign-off; they are prerequisites for
Excella AI OS agents running out-of-process.
