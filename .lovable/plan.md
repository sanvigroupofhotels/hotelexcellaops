# HEOS – Room Occupancy Completion & Multi-Room Operations

This plan closes UAT-047 properly and turns each room in a multi-room booking into an independently operational unit — while keeping the booking as the single commercial record and `booking_room_assignments` (segments) as the single source of truth for occupancy history.

Because the scope is large, I'll ship it in **four sequenced phases**. Each phase is independently deployable and verifiable; nothing in a later phase reworks an earlier phase.

---

## Phase 1 — Finish UAT-047 (segment integrity everywhere)

Goal: no code path reads `bookings.room_id` for historical rendering, and no write path silently rewrites past segments.

- Audit every remaining consumer and route through `getRoomOccupancySegments()` in `src/lib/room-occupancy.ts`:
  - `src/routes/_authenticated/house-view.tsx` — remove the last legacy `booking.room_id` fallbacks in the placement engine.
  - `src/lib/room-availability.ts`, `src/lib/rooms-api.ts::listOccupiedRoomIds` — segment window only.
  - `src/lib/hk-generator.ts`, `src/lib/hk-checkout-hook.ts` — HK derives target room from the segment covering the business date.
  - Owner dashboard + occupancy reports (`src/lib/owner-dashboard.functions.ts`, `src/lib/reporting/*`) — group room-nights by segment window.
  - Guest Portal booking detail — show the segment covering today.
- Harden `split_room_assignment` RPC:
  - Reject `effective_date < old.start_date` (never rewrite history).
  - Always stamp `ended_reason='room_change'` on the closed segment.
  - Sync `bookings.room_id` to the segment covering **today's business date**, not `new Date()`.
- Replace ad-hoc `syncLegacyBookingRoom` in `booking-room-assignments-api.ts` with the same server-side rule so client clock skew can't rewrite the "current" room.

Verification (manual UAT script committed to `docs/`):

1. 15–20 Jul stay, 101 → 105 on 18 Jul → House View, Booking Detail timeline, HK history and Owner Dashboard all show 101 for 15–17 and 105 for 18–19.
2. Attempt to "move" with an effective date before the segment start → server rejects with a clear error.
3. After move, cancel booking → both segments remain visible in history; only future occupancy clears.

## Phase 2 — Per-room operational identity

Goal: each room in a multi-room booking becomes an independently manageable operational record. The booking stays the commercial entity.

Schema (one migration):

- `public.booking_items` gets:
  - `primary_occupant_name text` (nullable — inherits Booking Holder when null in reads)
  - `primary_occupant_phone text` (nullable)
  - `operational_status text NOT NULL DEFAULT 'Reserved'`  
  (`Reserved | Checked-In | Checked-Out | Cancelled | No-Show`)
  - `checked_in_at timestamptz`, `checked_out_at timestamptz`
- `public.booking_room_assignments.booking_item_id uuid` — links a segment to the specific room within the booking (so moving room 3 of 10 doesn't touch rooms 1-2 or 4-10).
- Backfill: every existing assignment maps to the item at the same `position`; existing bookings' `status` propagates to each item's `operational_status`.
- Booking-level `bookings.status` becomes a **derived** state: `Checked-In` when ≥1 item is Checked-In and ≥1 still Reserved is treated as *In-House (Partial)*; `Checked-Out` only when every non-cancelled item is Checked-Out. Derivation runs in a trigger so downstream reports and the existing booking_status enum stay valid.

Server functions (`src/lib/booking-rooms.functions.ts`, new):

- `assignRoom({ booking_item_id, room_id })`
- `checkInRoom({ booking_item_id })` — creates/extends its assignment segment.
- `checkOutRoom({ booking_item_id })` — closes its assignment segment on business date.
- `moveRoom({ booking_item_id, new_room_id })` — wraps `split_room_assignment`.
- `setPrimaryOccupant({ booking_item_id, name, phone })`

Each function is `requireSupabaseAuth`, validates the item belongs to a booking the caller can edit, and writes an entry to `activity_log` + a new `booking_activities` entry.

Availability & HK:

- Room-type availability engine already sums by item; no change required beyond making it read `operational_status <> 'Cancelled'`.
- `hk-checkout-hook.ts` fires per **item** checkout, not per booking.
- `hk-generator.ts` iterates over checked-in items rather than bookings.

## Phase 3 — Booking Detail redesign: Room Management Grid

Goal: reception operates room-by-room from Booking Detail.

- New component `src/components/booking-rooms-grid.tsx` rendered inside `src/routes/_authenticated/bookings_.$id.tsx` (replaces the current single-room panel; keeps the timeline card).
- One row per `booking_item` × room count (a `rooms=3` item explodes into three rows):

  | #   | Assigned Room  | Primary Occupant | Status     | Actions                 |
  | --- | -------------- | ---------------- | ---------- | ----------------------- |
  | 1   | Oak-101        | Open State       | Checked-In | View · Move · Check-Out |
  | 2   | *(unassigned)* | Ramesh           | Reserved   | Assign · Check-In       |

- Each action opens the existing dialog scoped to the item (Assign → `RoomAssignmentDialog`, Move → `RoomAssignmentDialog` in `change` mode, Check-in/out → existing check-in flow, per item).
- "Primary Occupant" cell is inline-editable with a save-on-blur mutation → `setPrimaryOccupant`.
- The grid supports partial arrivals/departures by design — every action targets a single row.
- The existing "Check-In" and "Check-Out" buttons at the top of Booking Detail become bulk shortcuts ("Check-in all Reserved rooms") wrapping the per-item mutations in a transaction.

House View updates:

- Chip label uses **Primary Occupant** when set, otherwise Booking Holder. Long-press menu offers per-room actions.
- Housekeeping and Night Audit displays follow the same rule.

## Phase 4 — Audit trail, regression coverage, docs

- **Audit table**: `public.room_move_audit(id, booking_id, booking_item_id, from_room_id, to_room_id, effective_date, reason, actor_id, actor_name, actor_role, created_at)`. Written from the `moveRoom` server function; surfaced on Booking Detail timeline.
- **Playwright regression suite** (`tests/e2e/room-occupancy/*.spec.py`):
  1. Segment preservation on room move
  2. Stay extension resizes only the trailing segment
  3. Early checkout closes segment on business date
  4. Late checkout renders 75% chip and next-day chip skips the lane
  5. Cancellation clears future occupancy only
  6. Booking edit that rebalances room types keeps existing segments' history
  7. Multi-room booking with partial arrivals shows correct grid + House View states
  8. Availability engine excludes cancelled items only, not checked-out ones
  9. Night audit after mid-stay move generates HK task on the new room
- **Docs**: `docs/room-occupancy.md` — canonical description of the segment model + the "read from `getRoomOccupancySegments` only" rule; link from `docs/architecture.md`.

---

## Technical notes

- All schema changes flow through single migrations with GRANTs for `authenticated` + `service_role`; RLS mirrors existing `bookings`/`booking_items` policies (owner + admin).
- No parallel occupancy model: even the new grid queries segments via `getRoomOccupancySegments(booking_id)`; `booking_items.operational_status` is metadata for the row, not occupancy history.
- `bookings.room_id` continues to exist as a compatibility shortcut only; every read that matters uses segments. We document this in `docs/room-occupancy.md` and add a lint note in `src/lib/booking-room-assignments-api.ts`.
- Rollout order is strict: Phase 1 → 2 → 3 → 4. Each phase leaves the system usable if we pause.

---

## What I need from you before I start Phase 1

1. **Room-move retro-active window** — should we allow moves effective *later than* today's business date (schedule a future move), or restrict to "today only" as we do now? My default: today only, until we have a real use-case.
2. **Booking-level status** when only some rooms have checked in — do you want a new visible status label (e.g. *In-House (Partial)*) on House View header chips, or should we keep showing just `Checked-In` once any room is in?
3. **Primary Occupant vs Booking Holder** on invoices/receipts — invoices should keep the Booking Holder as the billed party, correct? Primary Occupant only appears in operational surfaces (House View, HK, Booking Detail)?

Once you confirm those three, I'll start Phase 1 immediately.

&nbsp;

&nbsp;

&nbsp;

Overall, I think this is an excellent plan (9.5/10). Lovable has understood the intent correctly and, importantly, is building on the occupancy-segment architecture rather than introducing another parallel model.

&nbsp;

I would reply with the following refinements and confirmations before they begin.

&nbsp;

&nbsp;

---

&nbsp;

Thanks, this overall direction aligns with the intended HEOS architecture. I agree with the phased implementation and would like to confirm the following decisions and add a few clarifications.

&nbsp;

1. Room Move Effective Date

&nbsp;

Please keep room moves restricted to the current Business Date only.

&nbsp;

We do not currently have an operational requirement for scheduling future room moves, and allowing future-dated moves would add unnecessary complexity to occupancy management, House View and Night Audit.

&nbsp;

If a future requirement arises, we can introduce it as a separate enhancement.

&nbsp;

&nbsp;

---

&nbsp;

2. Booking Status for Partial Check-ins

&nbsp;

I agree with introducing a visible "In-House (Partial)" status.

&nbsp;

Suggested behaviour:

&nbsp;

Reserved → No rooms checked in.

&nbsp;

In-House (Partial) → At least one room checked in but not all.

&nbsp;

Checked-In / In-House → All operational rooms checked in.

&nbsp;

Checked-Out → All non-cancelled rooms checked out.

&nbsp;

Cancelled / No-Show remain unchanged.

&nbsp;

&nbsp;

This gives Reception an immediate understanding of the booking's operational state.

&nbsp;

&nbsp;

---

&nbsp;

3. Booking Holder vs Primary Occupant

&nbsp;

Confirmed.

&nbsp;

The Booking Holder remains the commercial customer.

&nbsp;

The Primary Occupant belongs to the individual room and is used only for operational purposes.

&nbsp;

Invoices, payments, receipts, taxation, guest ledger and financial documents should continue to use the Booking Holder.

&nbsp;

Primary Occupant should appear only in operational surfaces such as:

&nbsp;

Booking Detail

&nbsp;

House View

&nbsp;

Housekeeping

&nbsp;

Room Move

&nbsp;

Check-in / Check-out

&nbsp;

Internal search (where appropriate)

&nbsp;

&nbsp;

&nbsp;

---

&nbsp;

Additional Clarifications

&nbsp;

A. Booking Holder must never be lost

&nbsp;

Even if every room has a different Primary Occupant, the Booking Holder must always remain available and visible because Reception often needs to contact the person who made the reservation.

&nbsp;

&nbsp;

---

&nbsp;

B. Occupant History

&nbsp;

If the Primary Occupant changes after check-in, please preserve the previous value in the activity log.

&nbsp;

Example:

&nbsp;

Open State → Rahul

&nbsp;

This should be auditable.

&nbsp;

&nbsp;

---

&nbsp;

C. Search Behaviour

&nbsp;

Please allow search by both:

&nbsp;

Booking Holder

&nbsp;

Primary Occupant

&nbsp;

&nbsp;

This will help Reception quickly locate guests regardless of whether they know the reservation holder or the actual occupant.

&nbsp;

&nbsp;

---

&nbsp;

D. Room Management Grid

&nbsp;

Please make this the primary operational interface for multi-room bookings.

&nbsp;

Reception should never have to leave Booking Detail to manage individual rooms.

&nbsp;

&nbsp;

---

&nbsp;

E. Future Compatibility

&nbsp;

Please ensure this design naturally supports future additions without schema redesign, including:

&nbsp;

Multiple occupants per room (future)

&nbsp;

ID verification per room

&nbsp;

Key card assignment

&nbsp;

Room-specific charges

&nbsp;

Room-specific notes

&nbsp;

Room-specific guest preferences

&nbsp;

&nbsp;

We are not implementing these now, but the architecture should not prevent them later.

&nbsp;

&nbsp;

---

&nbsp;

F. Audit Trail

&nbsp;

Please include all room operational actions in the audit trail, not only room moves.

&nbsp;

Examples:

&nbsp;

Room Assignment

&nbsp;

Check-in

&nbsp;

Check-out

&nbsp;

Primary Occupant changes

&nbsp;

Room Move

&nbsp;

&nbsp;

This will provide a complete operational history for each room.

&nbsp;

&nbsp;

---

&nbsp;

G. Regression Testing

&nbsp;

In addition to the proposed Playwright tests, please verify:

&nbsp;

Multi-room booking with different check-in dates.

&nbsp;

Partial check-outs.

&nbsp;

Mixed room moves and stay extensions.

&nbsp;

Night Audit after partial arrivals.

&nbsp;

Guest Portal behaviour remains correct.

&nbsp;

Availability calculations remain accurate throughout.

&nbsp;

&nbsp;

&nbsp;

---

&nbsp;

Other than these clarifications, I agree with the phased implementation. I also appreciate that the occupancy segments remain the single source of truth and that bookings.room_id is retained only as a compatibility field. That aligns with the long-term HEOS architecture and should give us a solid foundation for future modules like Maintenance, advanced Housekeeping, and richer guest operations.