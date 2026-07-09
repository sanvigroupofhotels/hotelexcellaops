# HEOS v1.0 — Notification Architecture (Future-Ready)

_Documentation only. Confirms the platform can accept a full Notification
Engine without touching operational modules. No implementation is required
before the Maintenance Module._

## Current state (v1.0)

- `notification-routing.ts` — deterministic recipient resolution from
  event → role → user, respecting permissions.
- `notification-engine.ts` — fan-out entry point; today writes to
  `notifications` and (optionally) dispatches email + push.
- `notifications` table — user-visible inbox, read-state per user.
- Delivery endpoints:
  - `api/public/push-dispatch.ts` — web push (VAPID)
  - `api/public/notification-email-dispatch.ts` — transactional email
  - In-app inbox — via `NotificationBell`.

## Decoupling contract

Operational modules NEVER call WhatsApp / SMS / email / push directly.
They call **one function** — the notification engine — with an event
payload. The engine owns:
- recipient resolution (routing rules per event type)
- transport selection (which channels apply)
- delivery ordering + retries
- user preferences (opt-in / opt-out, quiet hours)

This is already the contract in code. No operational module needs to
change when a new transport is added.

## Supported audience × event matrix (future-ready)

| Audience     | Event examples                                                                                        | Channels (future)              |
|--------------|--------------------------------------------------------------------------------------------------------|--------------------------------|
| Owner/Admin  | BookingCreated, BookingCancelled, DailyCashReport, DailyOccupancy, DailyRevenue, NightAuditCompleted, InventoryItemLow, LaundryDelay, CriticalComplaint | Push, Email, WhatsApp (later)  |
| Front Office | TodayArrivals, PendingCheckIn, PendingCheckOut, ExtensionRequest, PaymentPending                       | Push, In-app                   |
| Housekeeping | HKCheckoutTaskCreated, HKContinueServiceTaskCreated, HKManualTaskCreated, BatchReturned, InspectionRequired | Push, In-app                   |
| Guest        | BookingConfirmation (portal link), PreArrivalReminder, WelcomeMessage, WifiInfo, FoodOrderConfirmed/Ready, PaymentReceipt, CheckoutThanks, GoogleReviewRequest, PromoOffer (opt-in), Birthday/Anniversary, LeadFollowUp | WhatsApp, Email, SMS           |

## Provider adapters (deferred, all pluggable)

| Channel       | Provider (target)             | Adapter file                          |
|---------------|-------------------------------|---------------------------------------|
| Web Push      | VAPID (in place)              | `api/public/push-dispatch.ts`         |
| Email         | Resend / SES / Postmark       | `api/public/notification-email-dispatch.ts` |
| WhatsApp      | WhatsApp Business Cloud API   | `lib/notifications/whatsapp.ts` (future) |
| SMS           | Twilio / MSG91                | `lib/notifications/sms.ts` (future)   |

Adapters implement one interface — `send(recipient, template, vars)` —
letting the engine remain transport-agnostic.

## Templates + i18n

Templates should live in `master_data` (category `notification_template`)
so ops can edit copy without a deploy. Each template stores:
- key (event type)
- channel
- locale
- subject / body / merge fields
- opt-in category

## Consent + preferences

- Guest-facing marketing (promos, birthdays) MUST honor an opt-in flag
  captured at portal check-in and in `customers` (`marketing_opt_in`).
- Operational notifications (booking confirmation, payment receipt) are
  transactional and do not require marketing consent.
- User-level channel preferences belong on `profiles` (`notify_email`,
  `notify_push`, `notify_whatsapp`).

## What is already ready
- Event emission (see `docs/events.md`).
- Routing + engine + inbox.
- Push + email transports.
- Permission-scoped recipient resolution.

## What remains (post-v1.0, non-blocking)
- WhatsApp / SMS transport adapters.
- Template store in `master_data`.
- Marketing opt-in surfaces on portal + customer form.
- Idempotency keys per event so retries never double-deliver.

---

## v1.0 audience × event × channel matrix (future roadmap)

Legend: A=in-app, P=push, E=email, W=WhatsApp, S=SMS. Cell shows planned
channels; blank = not planned. Implementation follows the adapter
contract already documented above — no engine redesign required.

### Owner / Admin
| Event                       | A | P | E | W | S |
|-----------------------------|---|---|---|---|---|
| New Booking                 | ✓ | ✓ |   | ✓ |   |
| Booking Cancellation        | ✓ | ✓ | ✓ | ✓ |   |
| Daily Cash Book Report      | ✓ |   | ✓ | ✓ |   |
| Daily Revenue Summary       | ✓ |   | ✓ | ✓ |   |
| Occupancy Summary           | ✓ |   | ✓ |   |   |
| Low Inventory               | ✓ | ✓ | ✓ |   |   |
| Laundry Delay               | ✓ | ✓ |   |   |   |
| Critical Complaint          | ✓ | ✓ | ✓ | ✓ |   |
| Night Audit Completed       | ✓ |   | ✓ |   |   |

### Front Office
| Event               | A | P | E | W | S |
|---------------------|---|---|---|---|---|
| Arrivals            | ✓ | ✓ |   |   |   |
| Check-ins           | ✓ | ✓ |   |   |   |
| Check-outs          | ✓ | ✓ |   |   |   |
| Extension Requests  | ✓ | ✓ |   |   |   |
| Payment Pending     | ✓ | ✓ |   |   |   |

### Housekeeping
| Event                 | A | P | E | W | S |
|-----------------------|---|---|---|---|---|
| Checkout Task         | ✓ | ✓ |   |   |   |
| Service Task          | ✓ | ✓ |   |   |   |
| Manual Task           | ✓ | ✓ |   |   |   |
| Laundry Returned      | ✓ | ✓ |   |   |   |
| Inspection Required   | ✓ | ✓ |   |   |   |

### Guests
| Event                | A | P | E | W | S |
|----------------------|---|---|---|---|---|
| Booking Confirmation |   |   | ✓ | ✓ | ✓ |
| Guest Portal Link    |   |   | ✓ | ✓ | ✓ |
| Welcome Message      |   |   | ✓ | ✓ |   |
| Hotel Information    |   |   | ✓ | ✓ |   |
| Food Order Update    |   |   |   | ✓ |   |
| Payment Receipt      |   |   | ✓ | ✓ |   |
| Checkout Thank-you   |   |   | ✓ | ✓ |   |
| Review Request       |   |   | ✓ | ✓ |   |
| Promotional Campaign |   |   | ✓ | ✓ |   |
| Birthday Wishes      |   |   | ✓ | ✓ |   |
| Lead Follow-up       |   |   | ✓ | ✓ | ✓ |
