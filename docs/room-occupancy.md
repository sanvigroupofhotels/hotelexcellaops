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
