
-- Booking → Customer mobile sync trigger (1.3)
CREATE OR REPLACE FUNCTION public.bookings_sync_phone_to_customer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_phone text := NULLIF(trim(NEW.phone), '');
  v_cust_phone text;
BEGIN
  IF NEW.customer_id IS NULL OR v_new_phone IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND COALESCE(OLD.phone,'') = COALESCE(NEW.phone,'') THEN RETURN NEW; END IF;

  SELECT NULLIF(trim(phone),'') INTO v_cust_phone FROM public.customers WHERE id = NEW.customer_id;
  -- Only copy when the customer's phone is blank. Never overwrite.
  IF v_cust_phone IS NULL THEN
    UPDATE public.customers SET phone = v_new_phone WHERE id = NEW.customer_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_bookings_sync_phone_to_customer ON public.bookings;
CREATE TRIGGER trg_bookings_sync_phone_to_customer
AFTER INSERT OR UPDATE OF phone ON public.bookings
FOR EACH ROW EXECUTE FUNCTION public.bookings_sync_phone_to_customer();
