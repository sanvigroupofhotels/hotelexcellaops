-- 1. Booking-level conflict guards become segment-aware.
-- `bookings.room_id` is only a compatibility mirror. Comparing mirrors across
-- bookings wrongly rejects legitimate stay extensions and same-day turnover
-- for bookings whose real occupancy lives in booking_room_assignments.
CREATE OR REPLACE FUNCTION public.bookings_prevent_room_conflict()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_conflict_count int; v_has_segments boolean;
BEGIN
  IF NEW.room_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.status IN ('Cancelled','Checked-Out','Stay Completed','No-Show') THEN RETURN NEW; END IF;
  IF is_admin() THEN RETURN NEW; END IF;

  -- Segment-managed booking: real occupancy conflicts are enforced by
  -- bra_prevent_conflict on booking_room_assignments. The mirror must not
  -- veto date changes (stay extensions, partial turnover) here.
  SELECT EXISTS (SELECT 1 FROM public.booking_room_assignments a WHERE a.booking_id = NEW.id)
    INTO v_has_segments;
  IF v_has_segments THEN RETURN NEW; END IF;

  SELECT count(*) INTO v_conflict_count FROM public.bookings b
   WHERE b.room_id = NEW.room_id AND b.id <> NEW.id
     AND b.status NOT IN ('Cancelled','Checked-Out','Stay Completed','No-Show')
     -- Ignore other bookings that are segment-managed: their mirror may be
     -- stale after a room move / partial checkout.
     AND NOT EXISTS (SELECT 1 FROM public.booking_room_assignments a2 WHERE a2.booking_id = b.id)
     AND b.check_in < NEW.check_out AND NEW.check_in < b.check_out;
  IF v_conflict_count > 0 THEN
    RAISE EXCEPTION 'Room conflict: this room is already booked for an overlapping date range. Ask an admin to override.' USING ERRCODE='check_violation';
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.bookings_prevent_block_conflict()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_conflict int; v_has_segments boolean;
BEGIN
  IF NEW.room_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.status IN ('Cancelled','Checked-Out','Stay Completed','No-Show') THEN RETURN NEW; END IF;
  IF public.is_admin() THEN RETURN NEW; END IF;

  SELECT EXISTS (SELECT 1 FROM public.booking_room_assignments a WHERE a.booking_id = NEW.id)
    INTO v_has_segments;
  IF v_has_segments THEN RETURN NEW; END IF;

  SELECT count(*) INTO v_conflict FROM public.room_maintenance m
   WHERE m.room_id = NEW.room_id AND m.active = true
     AND m.start_date < NEW.check_out AND NEW.check_in < m.end_date;
  IF v_conflict > 0 THEN
    RAISE EXCEPTION 'Room is blocked for the selected dates. Unblock the room or ask an admin to override.' USING ERRCODE='check_violation';
  END IF;
  RETURN NEW;
END $function$;

-- 2. Legacy residue repair: departed bookings whose room items were left in
-- 'Confirmed' by the old booking-level-only lifecycle. Statuses only — no room
-- assignments are created or altered.
UPDATE public.booking_items i
   SET item_status = 'Checked-Out',
       checked_out_at = COALESCE(i.checked_out_at, (b.check_out::timestamp AT TIME ZONE 'Asia/Kolkata'))
  FROM public.bookings b
 WHERE b.id = i.booking_id
   AND b.status IN ('Checked-Out','Stay Completed')
   AND i.item_status IN ('Confirmed','Checked-In');

UPDATE public.booking_items i
   SET item_status = 'Cancelled'
  FROM public.bookings b
 WHERE b.id = i.booking_id
   AND b.status = 'Cancelled'
   AND i.item_status IN ('Confirmed','Checked-In');

UPDATE public.booking_items i
   SET item_status = 'No-Show'
  FROM public.bookings b
 WHERE b.id = i.booking_id
   AND b.status = 'No-Show'
   AND i.item_status IN ('Confirmed','Checked-In');
