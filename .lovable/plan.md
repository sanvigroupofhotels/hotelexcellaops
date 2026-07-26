# Milestone 1 Polish + Milestone 2 Delivery

Delivered in two incremental slices so each ships with its own "What Changed" report.

---

## Slice A — Milestone 1 UAT Polish (Room UX + Shared Services)

### A1. Room Card presentation (`RoomManagementGrid` in `bookings_.$id.tsx`)

- Header title = Primary Occupant name → fallback `Guest {n} — not assigned`. Never show "Room Item".
- Collapse duplicated room info into one hierarchy:
  ```text
  {Occupant or Guest n}                     [status pill]
  Room {number} • {room_type}     (or just "{room_type}" when unassigned)
  {check-in date} → {check-out date}
  Unassigned                        (only when no room)
  ```
- Move all row-level buttons (Assign / Move / Check-In / Check-Out / Revert CI / Revert CO / Edit Occupant / Edit Notes / Remove Room / View Timeline) into a single ⋮ menu on each card (shadcn `DropdownMenu`). Occupant + Notes editor becomes a modal opened from the menu.
- Add a Room-Management-level ⋮ menu next to the section title: Add Room (disabled placeholder until Slice B), Revert All Check-Ins, Revert All Check-Outs, Expand All, Collapse All.

### A2. Collapsible Lifecycle Timeline

- `BookingItemTimeline` wrapped in shadcn `Collapsible`, default `open={false}`. Header shows event count. No behavioural change; still reusable.

### A3. Per-item Revert operations

- New API in `booking-item-operations-api.ts`:
  - `revertItemCheckIn(itemId)` — status → Confirmed, clear `checked_in_at`, log `item_check_in_reverted`.
  - `revertItemCheckOut(itemId)` — status → Checked-In, clear `checked_out_at`, reopen last closed segment when it was closed via `item_check_out` (extend `end_date` back, honouring exclusion constraint), log `item_check_out_reverted`.
- Booking-level revert (existing) rewritten to iterate items via these shared calls, so both paths share one code path. Removes duplicate logic in `bookings-api`/status helpers.
- Timeline gets labels for the two new actions.

### A4. Single Add-Charge modal + Charge-To rules

- Audit for duplicate Add-Charge implementations across Booking Detail, House View popup, Dashboard "Add Charge" (`in-house-charges-section.tsx`, `house-view.tsx`, `_authenticated/index.tsx`). Consolidate into one exported `<AddChargeDialog bookingId itemId? />` living in `src/components/in-house-charges-section.tsx` (already the richest). Other callers switch to it.
- Charge-To field:
  - Single-room booking → hidden, auto-attributed to the sole item.
  - Multi-room booking → `Charge To *` required (Zod-side + inline error). No "Booking-level" default.

### A5. Shared "Currently In-House" query

- Introduce `src/lib/in-house.ts` exporting `listInHouseItems()` and `useInHouseItems()` — returns Booking Items where `item_status = 'Checked-In'` (falls back to booking-level checked-in when items are absent, for legacy bookings).
- Refactor consumers to this single source: dashboard (`_authenticated/index.tsx`), Add Charge picker, Add Payment picker, House View filters, Front Desk, Charges/Payments reports guest search. Any existing bespoke "in-house" filters are removed.

### A6. Regression additions

- Extend `tests/e2e/room-move-regression.spec.py` with:
  - Revert per-item check-in / check-out preserves siblings.
  - Add-Charge modal enforces mandatory Charge-To on multi-room, auto-fills on single-room.
  - Dashboard in-house list matches House View list.

---

## Slice B — Milestone 2: Add/Remove Room + Partial Arrivals/Departures

### B1. Database (single migration)

- No schema changes required for Add Room (uses existing `booking_items` + `booking_room_assignments`).
- Add function `add_booking_item_during_stay(p_booking_id, p_room_type, p_room_id?, p_effective_date, p_nightly_rate, p_occupant_name?, p_phone?)`:
  - Inserts a new `booking_items` row with `position = max+1`, `item_status='Confirmed'`, dates = effective_date → booking check_out.
  - When `p_room_id` provided, inserts a segment `[effective_date, check_out)` and sets `assigned_room_id`.
  - Recomputes booking totals (price additive; historical nights untouched).
  - Writes `item_added_during_stay` activity + booking activity.
- Function `remove_booking_item(p_item_id, p_reason)`:
  - Closes any active segment via `close_room_assignment_segment` (business date).
  - Marks the item `item_status='Removed'` (new enum value) with `removed_at`, `removed_reason`. Add `Removed` to the item-status check constraint.
  - Booking totals recompute from remaining items only.
  - Logs `item_removed`.

### B2. API layer

- `src/lib/booking-item-operations-api.ts`:
  - `addBookingItemDuringStay({...})` wraps the RPC. Availability check via existing `getRoomTypeAvailability` for `[effective_date, check_out)`.
  - `removeBookingItem(itemId, reason)` wraps the RPC + fires HK hook for vacated room.
- Booking status derivation (`booking-status.ts`): overall booking status computed from non-removed items — `Checked-Out` only when every remaining item is Checked-Out; `Checked-In` when at least one is Checked-In (existing partial-arrival semantics kept, now documented).

### B3. UI

- Room Management ⋮ → "Add Room": dialog with room type, optional specific room, effective business date (default = today), nightly rate (prefilled from rate engine), optional occupant. Reuses existing `RoomAssignmentDialog` for room picker.
- Room card ⋮ → "Remove Room" now visible for any non-removed item. Confirmation modal shows financial impact ("₹X for {n} remaining nights will be dropped"). Removed items rendered as muted, non-interactive cards below active ones so history stays visible in-page (full history remains in timeline).
- Timeline recognises `item_added_during_stay` and `item_removed`.

### B4. Regression suite (`tests/e2e/room-move-regression.spec.py`)

- Scenario 9: Add Room mid-stay — availability, price additive, siblings untouched, HK task not created for new room.
- Scenario 10: Remove Room — sibling untouched, price reduced, vacated room dirty, historical segment preserved.
- Scenario 11: Partial arrival — item A Checked-In while item B stays Confirmed; booking = Checked-In; House View renders both correctly.
- Scenario 12: Partial departure — item A Checked-Out while B still in-house; booking stays Checked-In; Night Audit passes.
- Scenario 13: Mixed states + Night Audit + pricing recompute after Add/Remove.
- Scenario 14: HK sync after Remove + Add on the same day.

### B5. Manual validation checklist

Provided in the "What Changed" report at the end of Slice B.

---

## Technical Notes

- All room ops continue to flow through `booking-item-operations-api.ts` (shared orchestration layer). No route/component talks to `booking_room_assignments` directly for mutations.
- Financial ownership stays at booking level; item attribution is metadata only.
- Historical occupancy is never rewritten: Add Room creates forward segment; Remove Room closes with `ended_reason='item_removed'`; Revert Check-Out extends the last segment forward without touching prior segments.
- Reusable timeline stays presentation-only; safe to embed in House View / HK / Guest Profile later.

## Deferred (called out at end of Slice B)

- Bulk Assign / Bulk Check-In-Out, Print Rooming List, Generate Key Cards, Issue Key Card, Verify ID, Maintenance Request from the room ⋮ menu.
- Reopening a Removed item (not requested for M2).

&nbsp;

Thank you. Overall, I agree with the proposed implementation plan.

The split into Slice A (Milestone 1 Polish) and Slice B (Milestone 2) is a good approach and aligns well with our milestone-based UAT process.

I have a few refinements and confirmations before implementation begins.

Slice A – Milestone 1 Polish

Overall I agree with all proposed refinements.

The direction of simplifying the Room Management UI while consolidating shared services is exactly what we are aiming for.

Room Card

I agree with:

Primary Occupant replacing "Room Item"

Cleaner room hierarchy

Per-room three-dot menu

Room Management section menu

Collapsible timeline

This should significantly improve usability, especially for larger group bookings.

Revert Operations

I agree with introducing:

Per-room Revert Check-In

Per-room Revert Check-Out

One clarification:

Please ensure the revert operation behaves exactly like the inverse of the original operation.

It should restore:

Booking Item status

Occupancy

Availability

Housekeeping

Activity Timeline

using the same shared operational workflow.

The booking-level Revert All actions should simply iterate over Booking Items using these shared APIs and should never contain independent business logic.

Shared Add Charge

I fully agree with consolidating every Add Charge entry point into one shared component.

Please ensure this remains the only Add Charge implementation throughout HEOS.

Future modules should also consume this component.

Shared In-House Query

I completely agree with introducing a shared listInHouseItems() service.

This should become the single operational definition of "Currently In-House" across the entire platform.

Slice B – Milestone 2

I agree with the overall scope.

However, I have several architectural recommendations.

1. Removed Items

I like the decision to retain removed Booking Items for history.

Rather than treating them as deleted operational rooms, they become part of the booking history.

Please ensure removed items:

remain searchable within the booking,

remain visible in the timeline,

remain visible in audit,

continue preserving all historical occupancy.

They should simply become inactive.

2. Add Room

Please ensure Add Room always creates a completely independent operational room.

That means:

new Booking Item,

new timeline,

new occupancy,

new housekeeping lifecycle,

new operational history.

No existing room should ever be modified.

3. Pricing

Please ensure pricing recalculation remains isolated.

Adding or removing one room should only affect that Booking Item's financial contribution.

The pricing of every remaining room must remain unchanged unless a separate rate modification is intentionally performed.

4. Availability

When adding a room during stay,

please continue using the shared Availability Engine.

There should never be a separate availability calculation inside Add Room.

5. Room Removal

The removed room card becoming muted is a good UX choice.

I would also recommend displaying a small status such as:

Removed

Cancelled before arrival

depending on the removal scenario.

This helps Reception immediately understand why the room still appears in history.

Additional Recommendation

I would like one additional architectural improvement included if practical.

Operational Event Bus (internal)

Every operational room action already generates activity.

Please consider funnelling these events through one internal operational event dispatcher.

Examples:

Room Assigned

Room Moved

Check-In

Check-Out

Revert Check-In

Revert Check-Out

Room Added

Room Removed

Occupant Updated

Notes Updated

Charge Added

Future modules such as:

Housekeeping

Maintenance

Guest Messaging

Mobile Apps

Reporting

Notifications

can subscribe to these operational events rather than introducing additional coupling.

This does not need to be a complex messaging system today—it can simply be an internal orchestration layer that centralises side effects.

Regression Suite

The proposed regression scenarios look comprehensive.

I particularly like that they now cover:

Add Room

Remove Room

Partial Arrivals

Partial Departures

Mixed Booking States

Night Audit

Housekeeping

Pricing

Please also ensure every regression verifies:

Booking Item ↔ Occupancy Segment linkage.

Timeline completeness.

No orphaned records.

Availability correctness.

These have become core invariants of the operational model.

Documentation

Please continue providing the "What Changed" summary after each slice, including:

Database changes

API changes

UI changes

Regression tests

Manual validation

Deferred items

These summaries have become very valuable for UAT and architecture reviews.

Final Direction

I am happy with the proposed roadmap and recommend proceeding with Slice A first.

Once Slice A passes UAT, we can continue with Slice B.

The milestone-by-milestone approach has worked extremely well so far and has significantly reduced regression risk while allowing the operational room model to mature in a controlled manner.

&nbsp;