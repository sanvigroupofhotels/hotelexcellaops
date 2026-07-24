
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Drop the legacy unique index. It assumed one segment per (booking, room, start_date)
-- which breaks the Phase 2 segmented-occupancy model where a guest may legitimately
-- return to a previously occupied room within the same booking.
DROP INDEX IF EXISTS public.booking_room_assignments_booking_room_start_uidx;

-- Replace with an exclusion constraint that prevents genuine overlap of segments
-- on the same (booking_id, room_id) using the half-open [start_date, end_date) range,
-- while allowing multiple disjoint segments (repeat occupancy of the same room).
ALTER TABLE public.booking_room_assignments
  DROP CONSTRAINT IF EXISTS booking_room_assignments_no_overlap;

ALTER TABLE public.booking_room_assignments
  ADD CONSTRAINT booking_room_assignments_no_overlap
  EXCLUDE USING gist (
    booking_id WITH =,
    room_id    WITH =,
    daterange(start_date, end_date, '[)') WITH &&
  );
