
CREATE OR REPLACE FUNCTION public.bookings_prevent_room_conflict()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_conflict_count int;
BEGIN
  IF NEW.room_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.status IN ('Cancelled','Checked-Out','Stay Completed','No-Show') THEN RETURN NEW; END IF;
  IF is_admin() THEN RETURN NEW; END IF;
  SELECT count(*) INTO v_conflict_count FROM public.bookings b
   WHERE b.room_id = NEW.room_id AND b.id <> NEW.id
     AND b.status NOT IN ('Cancelled','Checked-Out','Stay Completed','No-Show')
     AND b.check_in < NEW.check_out AND NEW.check_in < b.check_out;
  IF v_conflict_count > 0 THEN
    RAISE EXCEPTION 'Room conflict: this room is already booked for an overlapping date range. Ask an admin to override.' USING ERRCODE='check_violation';
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.bookings_prevent_block_conflict()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_conflict int;
BEGIN
  IF NEW.room_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.status IN ('Cancelled','Checked-Out','Stay Completed','No-Show') THEN RETURN NEW; END IF;
  IF public.is_admin() THEN RETURN NEW; END IF;
  SELECT count(*) INTO v_conflict FROM public.room_maintenance m
   WHERE m.room_id = NEW.room_id AND m.active = true
     AND m.start_date < NEW.check_out AND NEW.check_in < m.end_date;
  IF v_conflict > 0 THEN
    RAISE EXCEPTION 'Room is blocked for the selected dates. Unblock the room or ask an admin to override.' USING ERRCODE='check_violation';
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.bra_prevent_conflict()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_in date; v_out date; v_status text; v_conf int;
BEGIN
  SELECT check_in, check_out, status::text INTO v_in, v_out, v_status FROM public.bookings WHERE id = NEW.booking_id;
  IF v_status IN ('Cancelled','Checked-Out','Stay Completed','No-Show') THEN RETURN NEW; END IF;
  IF public.is_admin() THEN RETURN NEW; END IF;
  SELECT count(*) INTO v_conf FROM public.bookings b
   WHERE b.room_id = NEW.room_id AND b.id <> NEW.booking_id
     AND b.status NOT IN ('Cancelled','Checked-Out','Stay Completed','No-Show')
     AND b.check_in < v_out AND v_in < b.check_out;
  IF v_conf > 0 THEN
    RAISE EXCEPTION 'Room conflict: this room is already booked for an overlapping date range.' USING ERRCODE='check_violation';
  END IF;
  SELECT count(*) INTO v_conf FROM public.booking_room_assignments a
   JOIN public.bookings b ON b.id = a.booking_id
   WHERE a.room_id = NEW.room_id AND a.booking_id <> NEW.booking_id
     AND b.status NOT IN ('Cancelled','Checked-Out','Stay Completed','No-Show')
     AND b.check_in < v_out AND v_in < b.check_out;
  IF v_conf > 0 THEN
    RAISE EXCEPTION 'Room conflict: this room is already assigned to another overlapping booking.' USING ERRCODE='check_violation';
  END IF;
  SELECT count(*) INTO v_conf FROM public.room_maintenance m
   WHERE m.room_id = NEW.room_id AND m.active = true
     AND m.start_date < v_out AND v_in < m.end_date;
  IF v_conf > 0 THEN
    RAISE EXCEPTION 'Room is blocked for the selected dates.' USING ERRCODE='check_violation';
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.bookings_expire_docs_on_cancel()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.expire_guest_documents_for_booking(OLD.id);
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE'
     AND NEW.status::text IN ('Cancelled','No-Show')
     AND OLD.status::text IS DISTINCT FROM NEW.status::text THEN
    PERFORM public.expire_guest_documents_for_booking(NEW.id);
  END IF;
  RETURN NEW;
END $function$;
