# UAT-047 — Segmented Room Occupancy

Today `booking_room_assignments` has no date range: one row per (booking, room), so a "Change Room" mid-stay swaps the row and rewrites history. This plan turns each assignment into a date-bounded **segment**, splits the old segment at today's business date when reception moves an in-house guest, and updates every read path to honour the segment window.

## Decisions applied

- **Effective date:** today's business date, automatic (no new UI in the Move dialog).
- **Historical moves:** future moves only; existing rows backfilled to the booking's full window.

## Schema (one migration)

Add columns to `public.booking_room_assignments`:

- `start_date date` — inclusive; defaults to booking.check_in during backfill.
- `end_date date` — exclusive (matches `check_out` semantics); defaults to booking.check_out during backfill.
- `ended_reason text` — nullable (`room_change`, `manual_split`, later `booking_shortened`); purely audit metadata.

Backfill every existing row from its booking's `check_in` / `check_out`, then set `NOT NULL`. Replace the unique `(booking_id, room_id)` constraint with a partial unique index on `(booking_id, room_id, start_date)` so the same room can be re-entered later in the stay.

Rewrite `bra_prevent_conflict` to compare **segment windows** (`NEW.start_date`/`NEW.end_date`) against other assignments' segment windows, plus overlapping bookings' `check_in`/`check_out` and active `room_maintenance` blocks. Same admin bypass. Same error codes.

## Move flow (segmented split)

`RoomAssignmentDialog` mode `"change"` currently calls `removeAssignment` + `addAssignment`. Replace with a single RPC `split_room_assignment(booking_id, old_assignment_id, new_room_id, effective_date)`:

1. If `effective_date <= old.start_date`, treat as full replacement (no history yet) — update `room_id` in place.
2. Else set `old.end_date = effective_date`, `old.ended_reason = 'room_change'`.
3. Insert new row `(room_id = new_room_id, start_date = effective_date, end_date = booking.check_out)`.
4. Sync `bookings.room_id` to the segment covering the business date (keeps legacy chip logic honest).
5. Log booking activity `Room Changed: 201 → 205 (effective 18 Jul)`.

`effective_date` is derived server-side as `app_settings.business_date` clamped into `[booking.check_in, booking.check_out]`. Pre-arrival moves keep today's behaviour (full replacement). Late-checkout residuals are unaffected because they live on `booking_items`, not on the assignment window.

## Read-path updates

Every consumer of `booking_room_assignments` needs to project the new columns and filter by date:

- `src/lib/booking-room-assignments-api.ts` — return `start_date`/`end_date`; `addAssignment` seeds them from the booking window; new helper `listAssignmentsCoveringDate(booking_id, date)`.
- `src/lib/room-availability.ts` — replace the "bookings.check_in/check_out" join in the assignment sub-query with each assignment's own segment window.
- `src/lib/rooms-api.ts` `listOccupiedRoomIds` — same substitution; check the segment window, not the booking window.
- `src/lib/stay-segments.ts` `pairStaySlotsToRooms` — return `{ room_id, slot, start_date, end_date }`; pair by (segment window ∩ slot window) instead of one-shot slot pairing.
- `src/routes/_authenticated/house-view.tsx` — render one chip per **segment**, not per booking. `outgoingLateByRoomDay` now keyed off segment end. Room-swap moves stop overwriting the previous cell.
- `src/routes/_authenticated/bookings_.$id.tsx` — Room Timeline card lists segments in order (Room 201 · 15–18 Jul; Room 205 · 18–20 Jul).
- Booking timeline / activity feed — already OK once move flow logs `Room Changed (effective …)`.
- `src/lib/hk-generator.ts` — HK checkout tasks generate against the segment that ends on the checkout date; departure-cleaning task attaches to that room, not to `bookings.room_id`.
- `src/lib/hk-checkout-hook.ts` — same segment lookup on manual checkout.
- Occupancy / owner-dashboard reports (`src/lib/reporting/*`, `owner-dashboard.functions.ts`) — group room-nights by segment window instead of booking window.
- Guest Portal booking detail — display the segment covering the guest's current date.

## Regression coverage

Manual UAT after ship:

1. Single mid-stay move — 15–20 Jul, 201 → 205 on 18 Jul: House View 15–17 shows 201, 18–19 shows 205. Booking Detail shows two segments. HK generates checkout task on 205.
2. Multiple moves in one stay — 201 → 205 → 208. Three segments render in order.
3. Move after Late Check-out — late-checkout residual stays on old room's outgoing day, new segment renders from today. No chip overlap.
4. Pre-arrival "move" — Upcoming booking swap keeps single segment (no history to preserve).
5. Backfill sanity — every existing booking still shows exactly one segment covering the full stay.
6. Room availability — during the split, the old room becomes bookable again from the effective date onward.
7. Guest Portal — booking-summary card unaffected (room type × rooms).

## Out of scope

- Staff-picked effective date (deferred by decision above).
- Historical backfill from `activity_log` (deferred by decision above).
- Room-change UI on the House View long-press menu — already routes through `RoomAssignmentDialog`; picks up the new flow automatically.

&nbsp;

My comments - 

&nbsp;

The proposed implementation looks good and aligns with the expected behaviour.

One important architectural requirement to include:

Please ensure that booking_room_assignments (with its new date-bounded segments) becomes the single source of truth for room occupancy history throughout HEOS.

All current and future modules should derive room occupancy from these segments rather than inferring it from bookings.room_id or maintaining independent occupancy logic.

This includes, but is not limited to:

House View

Booking Detail

Housekeeping

Occupancy Reports

Owner Dashboard

Maintenance Module

Room History

Any future operational or reporting modules

bookings.room_id should only represent the current/effective room for compatibility and quick lookups. Historical occupancy must always come from the segmented booking_room_assignments records.

The goal is to maintain a single source of truth for room occupancy history, eliminate duplicate logic, and prevent future inconsistencies as HEOS evolves.

Also Please expose a shared helper/service (e.g. getRoomOccupancySegments() or equivalent) that all modules use instead of querying booking_room_assignments directly. This keeps the interpretation of occupancy segments centralized, so if the business rules evolve in the future (late checkout, temporary room holds, maintenance interactions, etc.), only one shared service needs to change rather than every module.

&nbsp;