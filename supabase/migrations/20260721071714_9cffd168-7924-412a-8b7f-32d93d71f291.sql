
-- UAT-047: Segmented Room Occupancy
-- Add date-bounded segments to booking_room_assignments

ALTER TABLE public.booking_room_assignments
  ADD COLUMN IF NOT EXISTS start_date date,
  ADD COLUMN IF NOT EXISTS end_date date,
  ADD COLUMN IF NOT EXISTS ended_reason text;

-- Backfill from bookings.check_in / check_out
UPDATE public.booking_room_assignments a
   SET start_date = b.check_in,
       end_date   = GREATEST(b.check_out, b.check_in + INTERVAL '1 day')::date
  FROM public.bookings b
 WHERE a.booking_id = b.id
   AND (a.start_date IS NULL OR a.end_date IS NULL);

ALTER TABLE public.booking_room_assignments
  ALTER COLUMN start_date SET NOT NULL,
  ALTER COLUMN end_date   SET NOT NULL;

-- Replace unique (booking_id, room_id) with (booking_id, room_id, start_date)
ALTER TABLE public.booking_room_assignments
  DROP CONSTRAINT IF EXISTS booking_room_assignments_booking_id_room_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS booking_room_assignments_booking_room_start_uidx
  ON public.booking_room_assignments (booking_id, room_id, start_date);

CREATE INDEX IF NOT EXISTS idx_bra_dates ON public.booking_room_assignments (start_date, end_date);

-- Rewrite conflict trigger to compare segment windows
CREATE OR REPLACE FUNCTION public.bra_prevent_conflict()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_status text;
  v_conf   int;
  v_in     date := NEW.start_date;
  v_out    date := NEW.end_date;
BEGIN
  SELECT status::text INTO v_status FROM public.bookings WHERE id = NEW.booking_id;
  IF v_status IN ('Cancelled','Checked-Out','Stay Completed','No-Show') THEN
    RETURN NEW;
  END IF;
  IF public.is_admin() THEN RETURN NEW; END IF;

  -- Overlapping legacy booking.room_id windows (bookings without segments yet)
  SELECT count(*) INTO v_conf FROM public.bookings b
   WHERE b.room_id = NEW.room_id
     AND b.id <> NEW.booking_id
     AND b.status NOT IN ('Cancelled','Checked-Out','Stay Completed','No-Show')
     AND NOT EXISTS (SELECT 1 FROM public.booking_room_assignments a2 WHERE a2.booking_id = b.id)
     AND b.check_in < v_out AND v_in < b.check_out;
  IF v_conf > 0 THEN
    RAISE EXCEPTION 'Room conflict: this room is already booked for an overlapping date range.' USING ERRCODE='check_violation';
  END IF;

  -- Overlapping assignment segments on the same room (any other booking, or a different segment on same booking)
  SELECT count(*) INTO v_conf FROM public.booking_room_assignments a
    JOIN public.bookings b ON b.id = a.booking_id
   WHERE a.room_id = NEW.room_id
     AND a.id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
     AND b.status NOT IN ('Cancelled','Checked-Out','Stay Completed','No-Show')
     AND a.start_date < v_out AND v_in < a.end_date;
  IF v_conf > 0 THEN
    RAISE EXCEPTION 'Room conflict: this room is already assigned to another overlapping segment.' USING ERRCODE='check_violation';
  END IF;

  -- Active maintenance blocks
  SELECT count(*) INTO v_conf FROM public.room_maintenance m
   WHERE m.room_id = NEW.room_id AND m.active = true
     AND m.start_date < v_out AND v_in < m.end_date;
  IF v_conf > 0 THEN
    RAISE EXCEPTION 'Room is blocked for the selected dates.' USING ERRCODE='check_violation';
  END IF;

  RETURN NEW;
END $function$;

-- Split an existing assignment at the business date and start a new segment on a new room.
-- Returns the new assignment id.
CREATE OR REPLACE FUNCTION public.split_room_assignment(
  p_booking_id uuid,
  p_old_assignment_id uuid,
  p_new_room_id uuid,
  p_effective_date date DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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

  -- Resolve effective date: caller override, else business_date, else today
  SELECT (value->>'date')::date INTO v_business
    FROM public.app_settings WHERE key = 'business_date';
  v_effective := COALESCE(p_effective_date, v_business, CURRENT_DATE);
  IF v_effective < v_booking.check_in THEN v_effective := v_booking.check_in; END IF;
  IF v_effective > v_booking.check_out THEN v_effective := v_booking.check_out; END IF;

  SELECT * INTO v_old FROM public.booking_room_assignments
   WHERE id = p_old_assignment_id AND booking_id = p_booking_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Assignment not found';
  END IF;

  IF v_effective <= v_old.start_date THEN
    -- Nothing to preserve — replace room in place
    UPDATE public.booking_room_assignments
       SET room_id = p_new_room_id
     WHERE id = p_old_assignment_id;
    v_new_id := p_old_assignment_id;
  ELSE
    -- Close old segment, insert new one
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

  -- Sync legacy bookings.room_id to the segment covering v_business (or the earliest current segment).
  UPDATE public.bookings
     SET room_id = (
       SELECT room_id FROM public.booking_room_assignments
        WHERE booking_id = p_booking_id
          AND start_date <= COALESCE(v_business, CURRENT_DATE)
          AND end_date   >  COALESCE(v_business, CURRENT_DATE)
        ORDER BY start_date DESC LIMIT 1
     )
   WHERE id = p_booking_id
     AND EXISTS (
       SELECT 1 FROM public.booking_room_assignments
        WHERE booking_id = p_booking_id
          AND start_date <= COALESCE(v_business, CURRENT_DATE)
          AND end_date   >  COALESCE(v_business, CURRENT_DATE)
     );

  RETURN v_new_id;
END $$;

GRANT EXECUTE ON FUNCTION public.split_room_assignment(uuid, uuid, uuid, date) TO authenticated;

-- Shared read-side helper: room occupancy segments for a booking (or all bookings if null).
-- Single source of truth for room occupancy history.
CREATE OR REPLACE FUNCTION public.get_room_occupancy_segments(p_booking_id uuid DEFAULT NULL)
RETURNS TABLE(
  assignment_id uuid,
  booking_id uuid,
  room_id uuid,
  start_date date,
  end_date date,
  ended_reason text,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $$
  SELECT a.id, a.booking_id, a.room_id, a.start_date, a.end_date, a.ended_reason, a.created_at
    FROM public.booking_room_assignments a
   WHERE (p_booking_id IS NULL OR a.booking_id = p_booking_id)
   ORDER BY a.booking_id, a.start_date, a.created_at;
$$;

GRANT EXECUTE ON FUNCTION public.get_room_occupancy_segments(uuid) TO authenticated;
