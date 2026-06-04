
-- Update recompute_customer_bookings to also refresh last_stay_date from completed past bookings only.
CREATE OR REPLACE FUNCTION public.recompute_customer_bookings(p_customer_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF p_customer_id IS NULL THEN RETURN; END IF;
  UPDATE public.customers c
  SET total_bookings = COALESCE(sub.cnt, 0),
      last_stay_date = sub.last_stay
  FROM (
    SELECT
      COUNT(*) FILTER (WHERE status IN ('Draft','Confirmed','Advance Paid','Full Paid','Stay Completed'))::int AS cnt,
      MAX(check_out) FILTER (WHERE status = 'Stay Completed' OR (status IN ('Confirmed','Advance Paid','Full Paid') AND check_out < CURRENT_DATE)) AS last_stay
    FROM public.bookings
    WHERE customer_id = p_customer_id
  ) sub
  WHERE c.id = p_customer_id;
END; $$;

-- Backfill: ensure every quote/booking has a customer (already enforced for bookings via NOT NULL).
-- Recompute all customer stats now.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.customers LOOP
    PERFORM public.recompute_customer_stats(r.id);
    PERFORM public.recompute_customer_bookings(r.id);
  END LOOP;
END $$;
