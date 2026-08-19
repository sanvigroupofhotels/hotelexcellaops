# Room Occupancy — Architecture

## Single Source of Truth

`public.booking_room_assignments` is the **only** authoritative record of
which physical room a guest occupied on which business date.

Each row is a date-bounded segment `[start_date, end_date)` scoped to one
booking. A mid-stay room change closes the current segment on the business
date and opens a new segment on the new room. Historical segments are
**immutable** — the database rejects any attempt to rewrite past days.

`bookings.room_id` is a **compatibility mirror** of the segment that covers
today's business date. It exists for legacy detail-page reads and quick
lookups. **Never** use it for:

- Availability calculations
- Occupancy history rendering
- Housekeeping targeting
- Reports or KPIs

## Shared Read Path

Every consumer must go through `getRoomOccupancySegments()`
(`src/lib/room-occupancy.ts`) or the direct segment table. Modules must not
re-implement occupancy from `bookings.room_id`:

| Module                | Reads segments via                          |
|-----------------------|---------------------------------------------|
| House View            | `booking_room_assignments` query in route   |
| Booking Detail        | `getRoomOccupancySegments(booking_id)`      |
| Room Availability     | `listAvailableRoomsForStay`                 |
| Occupied Rooms        | `listOccupiedRoomIds`                       |
| Housekeeping Generator| `hk-generator.ts` (checked-in bookings)     |
| Housekeeping Hooks    | `hk-checkout-hook.ts` (segments only)       |

## Write Path

Room moves go through the `split_room_assignment` RPC (surface:
`splitAssignment` in `booking-room-assignments-api.ts`). Guarantees:

1. **Never back-dated**: `p_effective_date < business_date` is rejected.
2. **Never rewrites history**: a segment that already covers past days
   cannot be replaced in place.
3. **Always stamps `ended_reason='room_change'`** on the closed segment.
4. **Server-side mirror sync**: `bookings.room_id` is updated to the segment
   covering the business date, in the same transaction.

## Policy: Effective Date

Room moves are **always effective on today's business date**. There is no
UI or RPC path to schedule a future move — if that requirement lands we
introduce it explicitly.

## Extending Read Paths

When adding a new module that touches room occupancy, follow this checklist:

- [ ] Query segments, not `bookings.room_id`.
- [ ] For a specific date, filter `start_date <= date AND end_date > date`.
- [ ] For a range, apply the half-open overlap rule
      `start_date < range_end AND end_date > range_start`.
- [ ] Skip segments where `bookings.status` is Cancelled / No-Show.
- [ ] Never assume one booking = one segment.

## Milestone 0 — Unified Room-Move Contract

Every room-move entry point in the app lands on the same server-side path:

```
UI caller                      →  Client wrapper                            →  RPC
────────────────────────────────────────────────────────────────────────────────
House View drag-and-drop          updateBookingStay() ─┐
Booking Detail Room Mgmt Grid     moveBookingItemRoom() ┼─→ splitAssignment() ─→ split_room_assignment
Room Assignment dialog            moveBookingItemRoom() ┘
```

- `moveBookingItemRoom({ itemId, newRoomId, effectiveDate? })` in
  `src/lib/booking-item-operations-api.ts` is the canonical item-centric
  wrapper. It resolves the active segment for the item and delegates to
  `splitAssignment`.
- `splitAssignment` (client) is the single place that calls the
  `split_room_assignment` RPC, writes the per-item activity row, and fires
  the housekeeping "room moved" hook.
- The RPC itself enforces the invariants: historical segments are
  immutable, GiST exclusion prevents overlapping occupancy, and
  `booking_items.assigned_room_id` is re-pointed to the new room.

No caller may write to `booking_room_assignments` directly for a move.

## Backfill Reconciliation

`backfill_booking_item_segment_links_for_booking(p_booking_id uuid)` is the
only reconciliation path invoked from `replaceBookingItems`. It is
**booking-scoped** — the older un-scoped variant was replaced because it
rewrote `item_status` for every booking property-wide, silently reversing
per-room check-ins and check-outs on unrelated bookings.

The scoped variant also refuses to overwrite items that already have
`checked_in_at` or `checked_out_at` set, so per-item lifecycle state
survives every booking header save.

## Regression Coverage

`tests/e2e/room-move-regression.spec.py` covers, at minimum:

1. `102 → 104 → 102` — three disjoint segments, history frozen.
2. `102 → 104 → 105 → 102` — deeper repeat cycle.
3. Multi-room booking — sibling item's segments never mutate on a move.
4. Move-back to a previously occupied room — GiST exclusion allows it.
5. Edit-after-move — unrelated booking saves do not flip per-item status.
6. Night audit after multiple moves closes cleanly.

## Same-Day Turnover (UAT-053)

Segments are half-open, so `A [13 Aug, 15 Aug)` and `B [15 Aug, 17 Aug)` on the
same room are **not** a conflict — that is a same-day turnover, not an overlap.

- Booking-level Check-Out now closes the booking's open segments on the business
  date (`closeOpenSegmentsForBooking`, `ended_reason='booking_check_out'`), the
  same trimming item-level check-out already did. History is never rewritten.
- `src/lib/house-view-placement.ts` is the pure House View *representation*
  engine. It renders both chips on the room row, tagging them
  `_turnoverDeparture` / `_turnoverArrival`. A departed booking is only hidden
  when a live booking genuinely overlaps the days it still occupies.
- `vacateDate()` clamps a departed booking to the business date so legacy
  untrimmed segments cannot fake a conflict.
- Unassigned stay slots with no clean lane are returned as `pendingArrivals`
  and rendered in the **Room Pending** section with the rooms expected to free
  up through checkout. This is display-only: `booking_items.assigned_room_id`
  stays NULL until Reception assigns a room.
- Availability is untouched — House View has no private availability math; it
  still reads segments through the shared engine.

Regression coverage: `tests/house-view-placement.test.ts`.

## Booking Item Lifecycle (shared derivation)

`src/lib/booking-item-lifecycle.ts` is the single source of truth for the
relationship between item state and booking state.

- **Item is authoritative.** Every physical room is an independent Booking Item
  with its own `item_status`, `checked_in_at`, `checked_out_at`.
- **Parent is derived.** `syncBookingStatusFromItems()` runs after every
  per-item action (check-in, check-out, revert, room removed, item removed):
  any item still `Checked-In` ⇒ booking `Checked-In` (partial departure keeps
  the booking live); all operational items departed ⇒ `Checked-Out`; all items
  Cancelled / No-Show ⇒ that terminal status; all `Confirmed` ⇒ pre-arrival
  payment status untouched.
- **Booking-level actions fan out.** `setBookingStatus()` calls
  `fanOutBookingStatusToItems()`, so a booking-level Check-In / Check-Out can
  never again leave items in `Confirmed` (root cause of the HEXB-310C65 case).

### Conflict guards are segment-aware

`bookings.room_id` is a mirror only. `bookings_prevent_room_conflict` and
`bookings_prevent_block_conflict` now return early for any booking that has
`booking_room_assignments` rows, and ignore other bookings that have segments.
Real occupancy conflicts are enforced by `bra_prevent_conflict` on the segment
table. This is what unblocked stay extensions: a stale mirror (after a room
move or a partial checkout of a multi-room booking) used to veto date changes
that the segment model considered perfectly valid.
