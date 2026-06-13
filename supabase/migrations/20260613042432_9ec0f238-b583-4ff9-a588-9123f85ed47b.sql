
CREATE TABLE public.booking_room_assignments (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  room_id uuid NOT NULL REFERENCES public.rooms(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (booking_id, room_id)
);
CREATE INDEX idx_bra_booking ON public.booking_room_assignments(booking_id);
CREATE INDEX idx_bra_room ON public.booking_room_assignments(room_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.booking_room_assignments TO authenticated;
GRANT ALL ON public.booking_room_assignments TO service_role;

ALTER TABLE public.booking_room_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bra_select_auth" ON public.booking_room_assignments FOR SELECT TO authenticated USING (true);
CREATE POLICY "bra_insert_auth" ON public.booking_room_assignments FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "bra_update_auth" ON public.booking_room_assignments FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "bra_delete_auth" ON public.booking_room_assignments FOR DELETE TO authenticated USING (true);

-- Conflict prevention: a room cannot overlap another active booking via either
-- bookings.room_id or another booking_room_assignments row.
CREATE OR REPLACE FUNCTION public.bra_prevent_conflict()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_in date; v_out date; v_status text; v_conf int;
BEGIN
  SELECT check_in, check_out, status::text INTO v_in, v_out, v_status FROM public.bookings WHERE id = NEW.booking_id;
  IF v_status IN ('Cancelled','Checked-Out','Stay Completed') THEN RETURN NEW; END IF;
  IF public.is_admin() THEN RETURN NEW; END IF;

  -- Conflict with bookings.room_id
  SELECT count(*) INTO v_conf FROM public.bookings b
    WHERE b.room_id = NEW.room_id
      AND b.id <> NEW.booking_id
      AND b.status NOT IN ('Cancelled','Checked-Out','Stay Completed')
      AND b.check_in < v_out AND v_in < b.check_out;
  IF v_conf > 0 THEN
    RAISE EXCEPTION 'Room conflict: this room is already booked for an overlapping date range.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Conflict with another assignment
  SELECT count(*) INTO v_conf FROM public.booking_room_assignments a
    JOIN public.bookings b ON b.id = a.booking_id
    WHERE a.room_id = NEW.room_id
      AND a.booking_id <> NEW.booking_id
      AND b.status NOT IN ('Cancelled','Checked-Out','Stay Completed')
      AND b.check_in < v_out AND v_in < b.check_out;
  IF v_conf > 0 THEN
    RAISE EXCEPTION 'Room conflict: this room is already assigned to another overlapping booking.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Maintenance block conflict
  SELECT count(*) INTO v_conf FROM public.room_maintenance m
    WHERE m.room_id = NEW.room_id AND m.active = true
      AND m.start_date < v_out AND v_in < m.end_date;
  IF v_conf > 0 THEN
    RAISE EXCEPTION 'Room is blocked for the selected dates.' USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER trg_bra_prevent_conflict
BEFORE INSERT OR UPDATE ON public.booking_room_assignments
FOR EACH ROW EXECUTE FUNCTION public.bra_prevent_conflict();

-- Backfill from bookings.room_id
INSERT INTO public.booking_room_assignments (booking_id, room_id, user_id)
SELECT id, room_id, user_id FROM public.bookings
WHERE room_id IS NOT NULL
ON CONFLICT DO NOTHING;
