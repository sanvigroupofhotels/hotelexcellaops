CREATE OR REPLACE FUNCTION public.can_cancel_bookings()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL AND (
    public.has_role(auth.uid(), 'owner'::public.app_role)
    OR public.has_role(auth.uid(), 'admin'::public.app_role)
  );
$$;
REVOKE ALL ON FUNCTION public.can_cancel_bookings() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_cancel_bookings() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.guard_booking_cancellation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_new_status text;
  v_old_status text;
BEGIN
  IF TG_TABLE_NAME = 'booking_items' THEN
    v_new_status := NEW.item_status::text;
    IF TG_OP = 'UPDATE' THEN v_old_status := OLD.item_status::text; END IF;
  ELSE
    v_new_status := NEW.status::text;
    IF TG_OP = 'UPDATE' THEN v_old_status := OLD.status::text; END IF;
  END IF;
  IF v_new_status IN ('Cancelled', 'No-Show')
     AND v_new_status IS DISTINCT FROM v_old_status
     AND NOT public.can_cancel_bookings() THEN
    RAISE EXCEPTION 'Only an owner or admin can cancel a booking or mark it as no-show.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_booking_cancellation() FROM PUBLIC, anon;
CREATE TRIGGER guard_booking_cancellation
BEFORE INSERT OR UPDATE ON public.bookings
FOR EACH ROW EXECUTE FUNCTION public.guard_booking_cancellation();
CREATE TRIGGER guard_booking_item_cancellation
BEFORE INSERT OR UPDATE ON public.booking_items
FOR EACH ROW EXECUTE FUNCTION public.guard_booking_cancellation();