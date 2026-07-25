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
