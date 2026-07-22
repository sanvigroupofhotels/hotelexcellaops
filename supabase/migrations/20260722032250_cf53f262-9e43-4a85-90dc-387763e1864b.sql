-- Phase 1: harden split_room_assignment to prevent historical rewrites.
-- Room moves are always effective on today's business date; retroactive
-- moves are rejected. `bookings.room_id` sync is server-authoritative.
CREATE OR REPLACE FUNCTION public.split_room_assignment(
  p_booking_id uuid,
  p_old_assignment_id uuid,
  p_new_room_id uuid,
  p_effective_date date DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_business date;
  v_effective date;
  v_booking record;
  v_old record;
  v_new_id uuid;
  v_user uuid := auth.uid();
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT id, check_in, check_out INTO v_booking
    FROM public.bookings WHERE id = p_booking_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking not found';
  END IF;

  SELECT (value->>'date')::date INTO v_business
    FROM public.app_settings WHERE key = 'business_date';
  v_business := COALESCE(v_business, CURRENT_DATE);

  -- Policy: moves are ALWAYS effective on today's business date.
  -- Callers may pass p_effective_date but retroactive dates are rejected —
  -- historical occupancy must never be rewritten.
  v_effective := COALESCE(p_effective_date, v_business);
  IF v_effective < v_business THEN
    RAISE EXCEPTION 'Room moves cannot be back-dated. Business date is %.', v_business
      USING ERRCODE = 'check_violation';
  END IF;
  -- Clamp to the booking window.
  IF v_effective < v_booking.check_in THEN v_effective := v_booking.check_in; END IF;
  IF v_effective > v_booking.check_out THEN v_effective := v_booking.check_out; END IF;

  SELECT * INTO v_old FROM public.booking_room_assignments
   WHERE id = p_old_assignment_id AND booking_id = p_booking_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Assignment not found';
  END IF;

  -- Guardrail: if the segment already covers past days, refuse to rewrite it.
  IF v_old.start_date < v_business AND v_effective <= v_old.start_date THEN
    RAISE EXCEPTION 'Cannot rewrite a segment that already covers past days (segment started %). Historical occupancy is immutable.', v_old.start_date
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_effective <= v_old.start_date THEN
    -- Pre-arrival / same-day-start: no history yet, replace room in place.
    UPDATE public.booking_room_assignments
       SET room_id = p_new_room_id
     WHERE id = p_old_assignment_id;
    v_new_id := p_old_assignment_id;
  ELSE
    -- Close old segment (preserving history), open new one.
    UPDATE public.booking_room_assignments
       SET end_date = v_effective,
           ended_reason = 'room_change'
     WHERE id = p_old_assignment_id;

    INSERT INTO public.booking_room_assignments
      (booking_id, room_id, user_id, start_date, end_date)
    VALUES
      (p_booking_id, p_new_room_id, v_user, v_effective, v_old.end_date)
    RETURNING id INTO v_new_id;
  END IF;

  -- Sync legacy bookings.room_id to the segment covering the business date.
  UPDATE public.bookings
     SET room_id = (
       SELECT room_id FROM public.booking_room_assignments
        WHERE booking_id = p_booking_id
          AND start_date <= v_business
          AND end_date   >  v_business
        ORDER BY start_date DESC LIMIT 1
     )
   WHERE id = p_booking_id
     AND EXISTS (
       SELECT 1 FROM public.booking_room_assignments
        WHERE booking_id = p_booking_id
          AND start_date <= v_business
          AND end_date   >  v_business
     );

  RETURN v_new_id;
END $function$;