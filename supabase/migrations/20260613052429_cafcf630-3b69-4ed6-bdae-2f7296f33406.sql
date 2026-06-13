-- Server-side guard: status cannot transition to Checked-In unless
-- the number of booking_room_assignments >= required rooms from booking_items.
CREATE OR REPLACE FUNCTION public.bookings_enforce_full_assignment_on_checkin()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_required int;
  v_assigned int;
BEGIN
  IF NEW.status::text <> 'Checked-In' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status::text = 'Checked-In' THEN RETURN NEW; END IF;

  SELECT COALESCE(SUM(GREATEST(1, COALESCE(rooms, 1))), 0)::int
    INTO v_required FROM public.booking_items WHERE booking_id = NEW.id;
  IF v_required = 0 THEN v_required := 1; END IF;

  SELECT COUNT(*)::int INTO v_assigned
    FROM public.booking_room_assignments WHERE booking_id = NEW.id;

  -- Legacy compatibility: if no assignment rows but bookings.room_id is set, count that as 1.
  IF v_assigned = 0 AND NEW.room_id IS NOT NULL THEN v_assigned := 1; END IF;

  IF v_assigned < v_required THEN
    RAISE EXCEPTION 'Please assign all rooms before Check-In (% of % assigned).', v_assigned, v_required
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS bookings_enforce_full_assignment_on_checkin ON public.bookings;
CREATE TRIGGER bookings_enforce_full_assignment_on_checkin
  BEFORE UPDATE OF status ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.bookings_enforce_full_assignment_on_checkin();