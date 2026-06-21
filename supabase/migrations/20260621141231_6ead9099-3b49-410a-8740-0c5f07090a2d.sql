
-- Replace BEFORE trigger with AFTER trigger; skip lead handling for staff bookings.
DROP TRIGGER IF EXISTS bookings_auto_convert_lead_biu ON public.bookings;

CREATE OR REPLACE FUNCTION public.bookings_auto_convert_lead()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Only Booking-Engine bookings carry an explicit lead_id. Staff/PMS bookings
  -- have lead_id = NULL and are intentionally skipped — leads are a
  -- Booking-Engine-only concept.
  IF NEW.lead_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Draft bookings shouldn't convert.
  IF NEW.status::text = 'Draft' THEN
    RETURN NEW;
  END IF;

  UPDATE public.leads
     SET status = 'Converted',
         converted_at = COALESCE(converted_at, now()),
         booking_id = NEW.id,
         customer_id = COALESCE(customer_id, NEW.customer_id),
         last_activity_at = now()
   WHERE id = NEW.lead_id
     AND status <> 'Converted';

  RETURN NEW;
END
$function$;

-- AFTER INSERT so bookings.id exists before the FK leads.booking_id is set.
-- Keep UPDATE OF status so a Draft→Confirmed transition still converts.
CREATE TRIGGER bookings_auto_convert_lead_aiu
AFTER INSERT OR UPDATE OF status ON public.bookings
FOR EACH ROW EXECUTE FUNCTION public.bookings_auto_convert_lead();
