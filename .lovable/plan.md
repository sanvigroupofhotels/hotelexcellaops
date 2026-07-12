# HEOS Core v1.1 — Stabilization Sprint 2

Scope: 8 items (UAT‑007, 008, 009, 019, 024, 025, 026, 027, 028). Lower priority items (UAT‑001/002/006/016/017/018/023) remain in backlog. All work reuses existing shared engines — no parallel business logic.

## P0 – Booking & Operational Correctness

### UAT‑007 — Booking ↔ Housekeeping sync (remaining edge cases)

**Root cause hypothesis:** hooks in `hk-checkout-hook.ts` cover extend/shorten and same-day re-check-in, but the "HK already completed Checkout task, then a fresh booking is created on the same room the same business day" path isn't triggered when the new booking is *created* (only when an existing booking is checked in). Multi-room bookings need per-room iteration on every hook.

**Changes:**

- `hk-checkout-hook.ts`: audit all four hooks (`onBookingCheckedOut`, `onBookingCheckoutShortened`, `onBookingCheckoutExtended`, `onBookingCheckedIn`) — ensure every one iterates `booking_room_assignments` and falls back to `bookings.room_number`. Add a new `onFreshBookingForRoomSameDay` invoked from `booking-create.ts` and `bookings-api.setBookingStatus('confirmed'|'checked_in')` when there is a completed HK Checkout task for that room + business date: it should re-open/create a `service` task for the new booking and cancel any residual `checkout` task tied to the old booking.
- Wire hooks symmetrically in `booking-stay.ts` (extend/shorten already wired, verify multi-room).
- Regression: existing single-room path unchanged.

### UAT‑008 — House View pricing sync everywhere

**Root cause:** `updateBookingStay` calls `booking-pricing-sync`, but Long Press / DnD paths in `house-view.tsx` mutate `booking_room_assignments` directly and only invalidate `booking`/`booking-items`. Room-move doesn't touch items pricing (correct) but popup room label doesn't refresh because House View caches assignments by booking, not by room.

**Changes:**

- Extract a single `refreshAfterBookingMutation(bookingId)` helper in `booking-pricing-sync.ts` that (a) recomputes pricing if item dates changed and (b) invalidates the standard set of query keys.
- Use it from every House View mutation path (long-press dialog, drag-drop, move-room, stay-extension inline).
- Confirm every mutation path awaits the refresh before closing the popup.

### UAT‑009 — Unified Availability Engine audit

**Root cause:** `listAvailableRoomsForStay` is the source of truth but three surfaces bypass it: (i) additional-room assignment inside `room-assignment-dialog.tsx` occasionally reads plain `rooms`, (ii) House View drag-drop uses a fast in-memory check that doesn't consider maintenance/blocks, (iii) Edit Booking room picker in a certain branch.

**Changes:**

- Grep-audit every caller and route it through `listAvailableRoomsForStay` (or the pure `isRoomAvailableForStay` predicate for single-room DnD checks).
- Add a shared `assertRoomsAvailable(roomIds, stay)` that throws `humanizeStayError`, invoked from Create/Edit/Extend/Move/DnD/LongPress/AdditionalRoom.
- Add unit test-shaped assertion inline (no test framework changes) that both Oak/Maple never exceed physical count.

### UAT‑019 — Night Audit blocker matrix

**Root cause:** `getPendingForAudit` uses `.lte` for check‑in/out on business_date (fixed sprint 1). Remaining gaps: bookings with `status='pending'` whose check-in was in the past aren't surfaced; open cash drawer session; unfinalised complaints marked "requires-nightly" aren't in the matrix.

**Changes:**

- Extend blocker list in `night-audit-api.ts`: pending-status past check-ins, un-finalised laundry batches for the day (optional), open cash close for business date if enabled.
- `perform-night-audit.ts` guard re-reads full matrix immediately before advancing (double-check pattern).
- Document blocker matrix in `docs/workflows.md` (Night Audit section).

## P0 – Customer Ledger & Payments

### UAT‑024 — Outstanding balance carry-forward

**Design:**

- Add a "Past Due" entry to `charge_catalog` seed if missing.
- On `createBooking` (booking-create.ts): after insert, look up customer's most recent booking with `status='checked_out'` (any variant, including force checkout) AND outstanding balance > 0. If found: create a `booking_charge` on the new booking with `category='Past Due'`, `amount = previous_outstanding`, description = `Carried from ${prev.booking_reference}`. Log to `booking_activities` on both bookings.
- Guard: only carry forward if there is no manually settled record; skip if the previous booking has been zero'd by adjustment.
- Add "Past Due" as a fixed seeded charge_catalog row via migration (idempotent upsert).

### UAT‑025 — Razorpay convenience fee reconciliation

**Design in** `razorpay-webhook.ts`**:**

- Payload contains `amount` (guest paid) and `notes.booking_amount` (expected booking due) or we compute expected from `razorpay_orders`.
- If `paid > booking_due`: split into two ledger entries — `booking_payment` = booking_due (applied), and a `booking_charge` (category='Razorpay Convenience Fee', amount=`paid − booking_due`, `paid_at=now`, linked payment id) auto-marked paid via a second `booking_payment` of the fee amount.
- Seed `charge_catalog` row "Razorpay Convenience Fee" via migration.
- Activity log entries on both charge and payment.
- Regression: exact-amount payments untouched.

## P1 – Due Collection

### UAT‑026 — Copy Due Summary

- Add a "Copy Due Summary" button in `dues.tsx` beside the filter chips.
- Reads currently filtered rows; format:
  ```
  {Filter Name} — Total {n} guests · ₹{total}
  1. {Guest Name} · Room {n} · ₹{due}
  2. …
  ```
- Uses `navigator.clipboard.writeText` with toast confirmation. Falls back to textarea select for mobile Safari.

## P1 – Notification Center

### UAT‑027 — Notification Center page

- Replace "Close" in `notification-bell.tsx` with "View All Notifications" → `/notifications`.
- New route `src/routes/_authenticated/notifications.tsx`: full history, search (title/body), filter (kind, read/unread, date range), Mark Read / Mark All Read, bulk-select toolbar.
- Reuses `notifications-api.ts`; adds `listAllNotifications`, `bulkMarkRead` if missing.

## P1 – Master Data (Finance)

### UAT‑028 — Finance masters audit & wiring

**Payment Modes:**

- `add-booking-payment-modal.tsx` currently hardcodes modes. Rewire via `useMasterData('payment_mode', FALLBACK)`.
- Preserve Cash → Cash Book behaviour by matching on the lowercased value/label (`mode.toLowerCase()==='cash'`), so admins renaming labels don't break the trigger.

**Charge Catalog:**

- Move from hyperlink in Finance group to a proper tab. Render an embedded charge-catalog editor inside master-data.tsx (or link to `/operations/charge-catalog` still, but present as a tab with an "Open Editor" primary action). Chosen approach: tab that shows a compact list inline with an "Open full editor" link, since the full editor already exists and this avoids duplicating CRUD.

**Expense Categories (**`expense_category` **lookup):**

- Ripgrep audit: verify no reference. If unreferenced → remove tab.

**GST / Taxes (**`tax` **lookup):**

- Ripgrep audit. If unreferenced → remove tab. (Pricing/tax logic lives in `pricing.ts` with config-driven values.)

**Cash Book Masters:**

- Rename `Expense Types (Legacy)` → `Expense Types`.

**Verification steps:** ripgrep each master key; document referenced-by list in `docs/modules.md` under Master Data.

## Deliverables

- `docs/workflows.md` — updated Night Audit + HK sync + Razorpay reconciliation sections.
- `docs/modules.md` — Master Data reference matrix.
- `.lovable/backlog.md` — reconcile P0/P1 to Done, keep lower-priority items open.

## Regression Surface (to be re-verified after implementation)

- Bookings create/edit/extend/shorten/move (single + multi-room)
- House View long-press / drag-drop
- Night Audit dry-run + advance
- Razorpay full-payment + partial-payment + refund
- Add Payment (Cash → Cash Book trigger)
- Dues page filters + copy
- Notification bell + new center
- Master Data all tabs + downstream dropdowns (Add Payment modal, in-house charges, etc.)

## Files Expected to Change

- `src/lib/hk-checkout-hook.ts`, `booking-create.ts`, `bookings-api.ts`, `booking-stay.ts`
- `src/lib/booking-pricing-sync.ts`, `src/routes/_authenticated/house-view.tsx`
- `src/lib/room-availability.ts` (helpers), `src/components/room-assignment-dialog.tsx`
- `src/lib/night-audit-api.ts`, `src/lib/perform-night-audit.ts`
- `src/routes/api/public/razorpay-webhook.ts`, `src/lib/booking-charges-api.ts`, `src/lib/booking-payments-api.ts`
- `src/routes/_authenticated/dues.tsx`
- `src/components/notification-bell.tsx`, `src/routes/_authenticated/notifications.tsx` (new), `src/lib/notifications-api.ts`
- `src/routes/_authenticated/master-data.tsx`, `src/components/add-booking-payment-modal.tsx`
- One migration: seed `Past Due` and `Razorpay Convenience Fee` in `charge_catalog` (idempotent).
- Docs: `workflows.md`, `modules.md`, `.lovable/backlog.md`.

&nbsp;

My comments 

Approved. The implementation plan looks good and aligns with the existing HEOS architecture.

One small request: for Payment Modes, if possible, please avoid relying on the display label/value (e.g., "cash"). Apply lower case comparison or something and make sure, this comparision doesn't  break anything - or Prefer a stable identifier or flag internally, which is convonient, so future renaming of payment modes doesn't affect Cash Book integration. 

Other than that, please proceed as planned.