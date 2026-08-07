# HEOS Shared Engines — Ownership Map

_Last reviewed: 2026-08-05 (v1.1 Final Production Readiness pass)_

Every domain in HEOS is owned by exactly one "engine" — a small,
well-scoped module that owns the schema, business rules, activity
logging and public API for that domain. Before adding new logic to a
screen, check this map: **if an engine already owns the behavior, extend
the engine rather than duplicating logic in the screen.**

## Engines

| Engine | Owns | Canonical files | Consumers |
|--------|------|-----------------|-----------|
| **Booking** | Booking lifecycle, statuses, room assignment, conflict checks | `booking-status.ts`, `booking-create.ts`, `bookings-api.ts`, `booking-stay.ts`, `booking-room-assignments-api.ts`, `booking-engine.functions.ts` | Bookings (Detailed + Quick), Calendar, House View, Portal, Booking Engine |
| **Pricing** | Nights × rate + taxes + discount + override math, resolved via `computePricing` | `pricing.ts`, `rates.ts`, `rates-api.ts`, `pricing-breakdown.tsx`, `use-resolved-rate.ts` | Bookings, Invoices, Portal, Booking Engine, WhatsApp share |
| **Guest Allocation** | Room-type occupancy rules (standard/max adults + children, extra-adult/child rates) and distribution of a party across Booking Items, incl. derived Extra Adults | `guest-allocation.ts` (occupancy config lives on `ROOM_TARIFFS.occupancy`) | Quick Booking, Detailed Booking, Clone Booking, quote → booking, `booking-items-api.addBookingItems`, future Booking Engine / OTA imports |
| **Customer / CRM** | Customer master, phone-based resolution, lead pipeline | `customers-api.ts`, `customer-resolution.ts`, `leads.functions.ts`, `phone.ts` | Bookings, Portal, Follow-ups, Complaints |
| **Payment** | Booking payments, refunds, Razorpay + cash sync | `booking-payments-api.ts`, `razorpay-completion.server.ts` (all gateway captures), `booking-payment-activities-api.ts`, `app-settings-api.ts` (payment settings), `payment-ocr.functions.ts` | Bookings, Cash, Portal |
| **Cash** | Cash book, cash audit close, cash reports | `cash-api.ts`, `cash-audit-api.ts`, `cash-report.ts` | Cash screens, Payments Reports |
| **Housekeeping** | Task lifecycle (checkout / service / DND / not-required), exceptions, checkout hook | `hk-tasks.ts`, `hk-generator.ts`, `hk-checkout-hook.ts`, `hk-status.ts`, `hk-issue-types-api.ts` | Housekeeping, HK Reporting, Night Audit, House View |
| **Laundry** | Queue, batches, vendor turnaround, in-house | `laundry-queue-api.ts`, `laundry-batches-api.ts`, `linen-master-api.ts` | Laundry screen, Laundry Reporting, HK completion |
| **Inventory** | Stock, movements, charge-catalog consumption | `inventory-items-api.ts`, `inventory-movements.ts`, `charge-catalog-api.ts` | Housekeeping, Bookings (charges), Reporting |
| **Vendor** | Vendor master + kind[] tagging | `vendors-api.ts` | Laundry, Complaints, Maintenance (planned), Inventory |
| **Complaint** | Complaint categories + status pipeline | `complaints-api.ts`, `hk-issue-types-api.ts` (mapping) | Complaints, HK issues, Maintenance (planned) |
| **Notification** | Push + email dispatch + notification rows | `notifications-api.ts`, `notification-engine.ts`, `notification-routing.ts`, `push-subscriptions.functions.ts`, `push-admin.functions.ts` | All modules that emit events |
| **Activity Log** | Universal audit trail | `activity-log.ts` | Every module |
| **Access / Roles** | Roles, permissions, per-user overrides | `access-api.ts`, `use-role.ts`, `use-permissions.ts`, `users-admin.functions.ts` | User Management, Role Management, Access Management, `PermissionGate` |
| **Night Audit** | Business date, EOD, sweeps, sessions | `night-audit-sessions-api.ts` (`closeSession` = only Business-Date advance), `night-audit-scheduler.ts`, `perform-night-audit.ts` (manual trigger), `night-audit-api.ts` (reads) | Night Audit screens, HK generation, `/api/public/night-audit-run` (pg_cron) |
| **Analytics / Reporting** | Aggregation helpers reading operational snapshots — **no business logic** | `reporting/date-range.ts`, `reporting/hk-reporting.ts`, `reporting/laundry-reporting.ts`, `kpi-defs.ts`, `owner-dashboard.functions.ts` | All Reporting routes |
| **Master Data** | Small enumerations (lead sources, complaint categories, etc.) | `master-data-api.ts`, `use-master-data.ts` | Bookings, Quotes, Complaints |
| **Business Date** | Single hotel-day clock (Asia/Kolkata) | `night-audit-api.ts` `getBusinessDate()`, `app_settings_guard_business_date` trigger | HK, Laundry, Reporting, NA, Payments |
| **Room Occupancy** | Historical + current room occupancy as `[start_date, end_date)` segments | `room-occupancy.ts`, `booking-room-assignments-api.ts` (`splitAssignment` → `split_room_assignment` RPC), `booking-item-operations-api.ts` (`moveBookingItemRoom`) | House View, Booking Detail, HK, Reporting |
| **Availability** | "Can this room / room type be sold or assigned for this window?" | `room-availability.ts` (per-room), `rooms-api.ts` (`listOccupiedRoomIds`, `findRoomConflicts`), `room-inventory.ts` (per room-type peak demand) | Booking forms, assignment dialogs, House View, Booking Engine |
| **Checkout Gating** | "May this guest check out?" | `checkout-validation.ts` | Booking Detail, Room Management Grid, bulk ops |
| **In-House** | "Who is in the hotel right now?" | `in-house.ts` | Dashboard, charges, House View |
| **Search** | Booking search across holder / occupant / phone / ref / room / company | `booking-search.ts` | House View, global search |
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

## Recent Consolidations (2026-08-05 — v1.1 hardening)

- **Razorpay capture** — `completeRazorpayCapture()` in
  `razorpay-completion.server.ts` is now the *only* implementation. The
  Booking Engine confirmation previously inserted `booking_payments`
  itself and skipped the convenience-fee split; it now calls the shared
  workflow with `collectedBy: "Booking Engine"`.
- **Room conflicts** — `findRoomConflicts()` now derives conflicts from
  `booking_room_assignments` segments instead of the legacy
  `bookings.room_id` mirror, so mid-stay room changes correctly free the
  vacated room.
- **Dead quote surfaces removed** — `quote-summary.tsx` deleted,
  `quote-messages.ts` reduced to the shared `waLink()` helper,
  `share-quote.ts` image-export aliases removed, and the residual
  "Create Quote" / "New Quote" entry points removed from the Customers
  screens.

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

- **Booking Conflict / Availability Engine** (P2) — there are still three
  overlap implementations with different granularity: `room-availability.ts`
  (per-room, DB-side filter), `rooms-api.ts` (`listOccupiedRoomIds`, JS-side,
  day-use aware) and `room-inventory.ts` (per room-type peak demand). All
  three now read occupancy segments, so results agree; the remaining work is
  collapsing them behind one assignment-time surface together with
  `blocks-api.ts`.
- **Booking Engine pricing** (P2) — `booking-engine.functions.ts` computes
  `subtotal / taxes / total` inline in three places (search, create, reprice)
  instead of calling `computePricing()`. Same formula, duplicated arithmetic.
- **Charge inserts** (P3) — `razorpay-completion.server.ts` and
  `booking-create.ts` insert `booking_charges` directly (both run with the
  admin client) rather than through `createBookingCharge()`.
- **Operational Rules Engine** (P2 architectural) — consolidate
  scattered event → effect rules once Maintenance adds the 5th rule.
- **Booking-list filtering** (P3 tech-debt) — consolidate between
  `bookings.tsx` and `calendar.tsx` into `booking-status.ts`.

## 2026-08-06 — Final engineering cleanup (pre-Maintenance freeze)

**Availability is now one service with three adapters.**

```
src/lib/occupancy-source.ts   ← ONLY module that reads occupancy rows
    listOccupancySegments()   booking_room_assignments (+ parent booking)
    listMaintenanceBlocks()   room_maintenance (active, overlapping)
    listBusyRoomIds()         union of both, as Set<room_id>
    datesOverlap()            canonical day-use-aware overlap predicate
    CLOSED_OCCUPANCY_STATUSES / NON_COMMITTED_DEMAND_STATUSES / pgStatusList()

src/lib/availability.ts       ← SINGLE public entry point for feature code
    1. getRoomTypeAvailability()   room-type sellable capacity (room-inventory.ts)
    2. listAvailableRoomsForStay() physical assignable rooms (room-availability.ts)
    3. findRoomConflicts() / listOccupiedRoomIds()  conflict checks (rooms-api.ts)
```

Rules: import availability from `src/lib/availability.ts`; never query
`booking_room_assignments`, `room_maintenance`, or `bookings.room_id` inline.
New granularities (including the Maintenance Module) become another adapter over
`occupancy-source`, never a new query.

**Pricing.** `applyTaxes(base, rate, taxesIncluded)` in `src/lib/pricing.ts` is
now the only place subtotal → taxes → total is derived. `computePricing()` and
the public Booking Engine (`booking-engine.functions.ts`, search + quote paths)
both call it; the engine no longer does inline tax arithmetic.

**Booking charges.** `buildBookingChargeRow()` in `src/lib/booking-charge-row.ts`
(pure, client-free) shapes and validates every charge. `createBookingCharge()`
wraps it for the browser; the server-side Razorpay convenience-fee split calls it
directly before inserting with the service role. No path constructs a charge row
by hand.

**Security.** Leaked-password protection (HIBP) is enabled on auth.

**Typecheck.** `bunx tsgo --noEmit` is clean — the TanStack search-param
strictness warnings were fixed at the source by typing each `validateSearch`
return with optional keys (`login`, `complaints`, `laundry`, `bookings/new`,
`night-audit/critical-tasks`), so callers no longer need dummy `search` objects.
