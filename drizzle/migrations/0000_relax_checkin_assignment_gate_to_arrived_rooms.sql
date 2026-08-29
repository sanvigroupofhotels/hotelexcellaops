CREATE OR REPLACE FUNCTION public.bookings_enforce_full_assignment_on_checkin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bd date;
  v_required int;
  v_assigned int;
BEGIN
  IF NEW.status::text <> 'Checked-In' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status::text = 'Checked-In' THEN RETURN NEW; END IF;

  SELECT COALESCE((value->>'date')::date, CURRENT_DATE)
    INTO v_bd FROM public.app_settings WHERE key = 'business_date';
  v_bd := COALESCE(v_bd, CURRENT_DATE);

  -- UAT-054: a multi-room booking may have rooms arriving on LATER dates.
  -- Only rooms that have actually arrived (item check_in <= business date) and
  -- are still operational need a room assigned before the booking can be
  -- Checked-In. Future-dated rooms must never block check-in of arrived rooms.
  SELECT COALESCE(SUM(GREATEST(1, COALESCE(rooms, 1))), 0)::int,
         COALESCE(SUM(CASE WHEN assigned_room_id IS NOT NULL THEN GREATEST(1, COALESCE(rooms, 1)) ELSE 0 END), 0)::int
    INTO v_required, v_assigned
    FROM public.booking_items
   WHERE booking_id = NEW.id
     AND COALESCE(item_status::text, 'Confirmed') NOT IN ('Cancelled', 'No-Show', 'Removed')
     AND COALESCE(check_in, NEW.check_in) <= v_bd;

  -- No items at all (legacy booking) → fall back to the parent booking row.
  IF NOT EXISTS (SELECT 1 FROM public.booking_items WHERE booking_id = NEW.id) THEN
    v_required := 1;
    SELECT COUNT(*)::int INTO v_assigned
      FROM public.booking_room_assignments WHERE booking_id = NEW.id;
    IF v_assigned = 0 AND NEW.room_id IS NOT NULL THEN v_assigned := 1; END IF;
  END IF;

  IF v_required > 0 AND v_assigned < v_required THEN
    RAISE EXCEPTION 'Please assign rooms for all arrived rooms before Check-In (% of % assigned).', v_assigned, v_required
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;