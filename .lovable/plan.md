# HEOS Core v1.1 — Stabilization Sprint 1

Nine UAT findings, all rooted in real operational gaps. Approach: extend existing shared engines, never fork logic.

## P0 — UAT-001 Manual Laundry Pickup

Current state: partial manual entry already exists in `laundry.tsx` (`manualSent`, `manualPickerOpen`, `qty_heos_queue: 0` on manual lines). Gaps: pickup blocked when queue is empty in some paths; manual-picker UX; verify manual lines flow identically through Batch Detail, Return, Correct-Return, Short/Damaged/Lost, Reporting, Monthly Billing, Vendor Statements, CSV Export.

Changes

- `src/routes/_authenticated/laundry.tsx` — allow creating batch with zero queue rows (already `activeRows.length === 0 && manualTotal === 0` gate is fine but needs review); polish manual add UX; ensure Linen Types Master is single source (already `listLinenTypes`, no free text).
- `src/lib/laundry-batches-api.ts` — audit that all reads/aggregations key on the batch line itself (not on `laundry_queue`), so manual lines with `qty_heos_queue = 0` behave identically. Fix any spot that filters `qty_heos_queue > 0`.
- `src/lib/reporting/laundry-reporting.ts` — verify aggregations count manual lines.
- CSV export helpers under laundry — include manual rows unchanged.

## P0 — UAT-007 Booking Extension Intelligence

Single choke-point: `src/lib/hk-checkout-hook.ts` (`onBookingExtended`, `onBookingCheckoutShortened`, `onBookingReCheckedIn`). Ensure every entry point calls it; add missing branches.

Changes

- `src/lib/booking-stay.ts` — already calls `onBookingExtended` when `newOut > oldOut`. Add symmetric call `onBookingCheckoutShortened` when `newOut < oldOut` so previously-generated service tasks are re-evaluated / removed if the new checkout no longer overlaps HK's business date.
- `src/lib/hk-checkout-hook.ts` — extend `onBookingExtended` and add `onBookingCheckoutShortened` to handle Scenario 2 (date changed again): close/reopen tasks based on new `check_out` vs business date. Add `onBookingReCheckedIn` for Scenario 3 (fresh booking, same guest+room after checkout task completed): if a completed Checkout task exists for that room on today's business date and a new Checked-In booking begins today, generate a Service task instead of a redundant Checkout task.
- Multi-room (Scenario 4): iterate `booking_room_assignments` in `onBookingExtended` / shortened / re-check-in. Verify current hook already loops per-room; add if missing.
- Entry points to audit: `booking-stay.ts`, `check-in-flow.tsx`, `booking-create.ts`, `bookings_.$id_.edit.tsx`, portal extension, night-audit rollover.

## P0 — UAT-008 House View pricing refresh

`useResolvedRate` already exists but House View mutations don't recompute stored booking totals. Edit-Booking `save` presumably calls a pricing recompute — extract to a shared helper.

Changes

- New `src/lib/booking-pricing-sync.ts` (or inline into `booking-stay.ts`) — after any stay mutation, recompute derived totals using the same engine Edit Booking uses (rate × nights × items + charges − discounts − payments), persist to `bookings` and `booking_items`. Reuse existing `pricing.ts` helpers.
- `src/lib/booking-stay.ts` — call the recompute after successful update, before returning.
- House View long-press popup, move dialog, and DnD — invalidate the relevant React Query keys (`bookings`, `booking-items`, `house-view`) so the popup/summary refresh instantly. Confirm they already `invalidateQueries` on success; add missing keys.

## P0 — UAT-009 Availability everywhere

`src/lib/room-availability.ts` (`listAvailableRoomsForStay`) is the source of truth. Audit every entry point:

- Create Booking (`bookings_.new.tsx`, `booking-create.ts`)
- Edit Booking (`bookings_.$id_.edit.tsx`)
- Room Assignment dialog
- Room Move dialog + `booking-stay.ts`
- House View long-press, DnD
- Additional room assignment
- Stay extension

Server-side: DB triggers already reject conflicts. Client-side: ensure UI room pickers call `listAvailableRoomsForStay` and never fall back to a plain `rooms` list. Add missing calls; humanize errors via `humanizeStayError`.

## P0 — UAT-019 Night Audit blockers

`src/lib/perform-night-audit.ts` — extend pre-flight validation to reject rollover when any booking has status Confirmed/Pending with `check_in <= businessDate` (i.e. pending arrival on the current business date). Surface actionable blocker list in the Night Audit stepper.

## P1 — UAT-010 Guest Portal always accessible

Locate the button gate (probably in `bookings_.$id.tsx` or `portal.functions.ts` share flow). Remove the balance-zero condition; portal token stays valid regardless of balance. Payment section inside portal hides itself when balance is 0 (already the case).

## P2 — UAT-006 Housekeeping Work History nav

Add a "Work History" secondary link inside the Housekeeping route header/toolbar that navigates to `/reporting/housekeeping` with the "Work History" tab preselected via a URL param. No duplicate page.

## P3 — UAT-021 Cash Book action labels

`src/routes/_authenticated/cash.tsx` — rename action buttons to exactly `(+) Cash In` and `(-) Cash Out`, remove the leading icon.

## Regression scope

- Laundry: full pickup → return → correction cycle; monthly billing.
- Bookings: create, edit, extend, shorten, move, DnD, portal extend, multi-room.
- Housekeeping: task lifecycle across extension edge cases.
- Night Audit: blocker enforcement (should now surface pending check-ins).

## Deliverables

- Root-cause note per UAT (in-code comments where non-obvious + one-line summary in reply).
- Updated `docs/workflows.md` where behaviour changes (extension intelligence, availability engine reuse, night-audit blockers).
- `.lovable/backlog.md` reconciled.

Estimated diff: ~10–14 files, mostly under `src/lib/` and 3 route files. No schema migrations expected.

&nbsp;

&nbsp;

My comments: 

The plan looks good overall and I agree with the implementation approach. I appreciate that you're extending the existing shared engines instead of introducing parallel logic.

&nbsp;

A few additional points to consider while implementing:

&nbsp;

1. Laundry Manual Pickup

&nbsp;

Please ensure the Pickup screen is architecturally treated as merging two input sources:

&nbsp;

HEOS Suggested Linen (Housekeeping Queue)

&nbsp;

Manual Linen Entries (selected from Linen Types Master)

&nbsp;

&nbsp;

Once Confirm Pickup is clicked, both should become ordinary laundry_batch_lines.

&nbsp;

From that point onwards, no downstream workflow should distinguish between queue-generated and manually added lines, except for audit purposes (qty_heos_queue = 0).

&nbsp;

This includes:

&nbsp;

Batch Detail

&nbsp;

Return

&nbsp;

Correct Return

&nbsp;

Short / Damaged / Lost

&nbsp;

Reporting

&nbsp;

Monthly Billing

&nbsp;

Vendor Statements

&nbsp;

CSV Exports

&nbsp;

Activity Log

&nbsp;

&nbsp;

The vendor slip remains the operational source of truth.

&nbsp;

&nbsp;

---

&nbsp;

2. Booking ↔ Housekeeping Intelligence

&nbsp;

While implementing the extension intelligence, please think operationally rather than matching only on guest identity.

&nbsp;

If a room becomes occupied again on the same business date (even if Reception creates a completely new booking for the same room), the Housekeeping workflow should intelligently transition from Checkout to Service wherever appropriate.

&nbsp;

The operational state of the room should drive the task lifecycle.

&nbsp;

&nbsp;

---

&nbsp;

3. Pricing & Availability

&nbsp;

Please ensure there is truly one shared Pricing Engine and one shared Availability Engine reused by every mutation path.

&nbsp;

This should include:

&nbsp;

Create Booking

&nbsp;

Edit Booking

&nbsp;

Stay Extension

&nbsp;

Room Move

&nbsp;

Drag & Drop

&nbsp;

Long Press actions

&nbsp;

Additional Room Assignment

&nbsp;

Portal flows (where applicable)

&nbsp;

&nbsp;

Both client-side validation and server-side validation should consistently use the same engines.

&nbsp;

&nbsp;

---

&nbsp;

4. Night Audit

&nbsp;

Please review the complete blocker matrix, not just pending Check-ins.

&nbsp;

Business Date should never advance while any operational blocker exists, including (where applicable):

&nbsp;

Pending Check-ins

&nbsp;

Pending Check-outs

&nbsp;

Business Date inconsistencies

&nbsp;

Any other operational blockers that should prevent day closure

&nbsp;

&nbsp;

The Night Audit should remain the single authoritative gate for Business Date advancement.

&nbsp;

&nbsp;

---

&nbsp;

5. Final Regression

&nbsp;

Since this sprint touches Booking, Housekeeping, Laundry and Night Audit together, please perform one final end-to-end regression after implementation.

&nbsp;

Please validate the complete operational flow:

&nbsp;

Booking → Check-in → Extension → Room Move → Checkout → Housekeeping → Laundry → Night Audit → Business Date Advance

&nbsp;

If you discover any regressions while implementing these changes, please proactively fix them before handing the build back for UAT.

&nbsp;

Apart from these additions, I agree with the proposed implementation plan. Please proceed.