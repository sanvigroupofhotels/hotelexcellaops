-- Backfill assignment segments whose end_date lags behind the booking's
-- current check_out (single-segment stays only, to avoid disturbing
-- mid-stay room changes). This repairs any stays that were extended
-- before the app-level sync landed, so their House View chips render
-- the full new stay length.
WITH single_seg AS (
  SELECT booking_id
  FROM public.booking_room_assignments
  GROUP BY booking_id
  HAVING COUNT(*) = 1
)
UPDATE public.booking_room_assignments a
SET end_date = b.check_out,
    start_date = LEAST(a.start_date, b.check_in)
FROM public.bookings b
WHERE a.booking_id = b.id
  AND a.booking_id IN (SELECT booking_id FROM single_seg)
  AND (a.end_date <> b.check_out OR a.start_date > b.check_in)
  AND b.status NOT IN ('Cancelled','No-Show');