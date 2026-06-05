-- Move existing Draft bookings to Pending
UPDATE public.bookings SET status = 'Pending' WHERE status = 'Draft';
ALTER TABLE public.bookings ALTER COLUMN status SET DEFAULT 'Pending'::booking_status;

-- Booking auto-link-or-create customer trigger (mirror quotes)
DROP TRIGGER IF EXISTS bookings_link_customer ON public.bookings;
CREATE TRIGGER bookings_link_customer
BEFORE INSERT ON public.bookings
FOR EACH ROW EXECUTE FUNCTION public.link_or_create_customer();

-- Auto-mark bookings Stay Completed when checkout date is past 5 PM
CREATE OR REPLACE FUNCTION public.sweep_stay_completed()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE n integer;
BEGIN
  WITH upd AS (
    UPDATE public.bookings
    SET status = 'Stay Completed'::booking_status
    WHERE status NOT IN ('Cancelled','Stay Completed')
      AND (check_out::timestamp + interval '17 hours') < now()
    RETURNING 1
  ) SELECT count(*) INTO n FROM upd;
  RETURN COALESCE(n,0);
END $$;

GRANT EXECUTE ON FUNCTION public.sweep_stay_completed() TO authenticated;