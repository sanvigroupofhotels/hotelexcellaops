-- Repair day-use assignments where start_date == end_date (zero-length window).
-- These were flattened by the prior repair migration and now fail the
-- half-open [start_date, end_date) coverage check, causing House View to
-- drop the assignment and place the guest into an unrelated lane.
UPDATE public.booking_room_assignments a
SET end_date = (a.start_date + INTERVAL '1 day')::date
WHERE a.end_date <= a.start_date;