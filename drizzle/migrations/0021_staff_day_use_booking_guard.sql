CREATE OR REPLACE FUNCTION public.guard_staff_day_use() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_changed boolean; v_permission text;
BEGIN
 IF NEW.check_out < NEW.check_in THEN RAISE EXCEPTION 'Check-out cannot be before check-in.' USING ERRCODE='23514'; END IF;
 IF NEW.check_in <> NEW.check_out THEN RETURN NEW; END IF;
 v_changed := TG_OP='INSERT';
 IF TG_OP='UPDATE' THEN v_changed := NEW.check_in IS DISTINCT FROM OLD.check_in OR NEW.check_out IS DISTINCT FROM OLD.check_out; END IF;
 IF v_changed THEN
  v_permission := CASE WHEN TG_OP='INSERT' THEN 'bookings.create' ELSE 'bookings.edit' END;
  IF auth.uid() IS NULL OR NOT (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'owner'::public.app_role) OR public.has_role(auth.uid(), 'fo_staff'::public.app_role) OR public.has_role(auth.uid(), 'reception'::public.app_role)) OR NOT EXISTS (SELECT 1 FROM public.my_permissions() p WHERE p=v_permission) THEN
   RAISE EXCEPTION 'Only Front Office or administrators can create or change day-use bookings.' USING ERRCODE='42501';
  END IF;
 END IF;
 IF TG_TABLE_NAME='bookings' THEN
  IF v_changed AND NEW.expected_departure_at IS NULL THEN NEW.expected_departure_at := (NEW.check_out::date + TIME '18:00') AT TIME ZONE 'Asia/Kolkata'; END IF;
  IF NEW.expected_arrival_at IS NOT NULL AND NEW.expected_departure_at IS NOT NULL AND NEW.expected_departure_at <= NEW.expected_arrival_at THEN RAISE EXCEPTION 'Day-use departure must be after arrival.' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_staff_day_use() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER guard_staff_day_use_booking BEFORE INSERT OR UPDATE OF check_in, check_out, expected_arrival_at, expected_departure_at ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.guard_staff_day_use();
CREATE TRIGGER guard_staff_day_use_item BEFORE INSERT OR UPDATE OF check_in, check_out ON public.booking_items FOR EACH ROW EXECUTE FUNCTION public.guard_staff_day_use();