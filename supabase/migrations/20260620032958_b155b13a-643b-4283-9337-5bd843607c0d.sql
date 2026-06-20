CREATE OR REPLACE FUNCTION public.bookings_derive_payment_status()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Pay-at-hotel bookings are legitimate confirmed reservations even with no advance paid.
  IF COALESCE(NEW.pay_at_hotel, false) = true
     AND COALESCE(NEW.advance_paid, 0) <= 0
     AND NEW.status IN ('Pending', 'Confirmed', 'Draft') THEN
    NEW.status := 'Confirmed'::booking_status;
    NEW.payment_status := 'Pending Payment';
    RETURN NEW;
  END IF;

  -- Only auto-derive payment lifecycle statuses before check-in / completion / cancellation.
  IF NEW.status IN ('Pending', 'Confirmed', 'Advance Paid', 'Full Paid', 'Draft') THEN
    IF COALESCE(NEW.advance_paid, 0) <= 0 THEN
      NEW.status := 'Pending'::booking_status;
      NEW.payment_status := 'Pending Payment';
    ELSIF COALESCE(NEW.advance_paid, 0) >= NEW.amount THEN
      NEW.status := 'Full Paid'::booking_status;
      NEW.payment_status := 'Full Paid';
    ELSE
      NEW.status := 'Advance Paid'::booking_status;
      NEW.payment_status := 'Advance Paid';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_bookings_derive_payment_status ON public.bookings;
CREATE TRIGGER trg_bookings_derive_payment_status
  BEFORE INSERT OR UPDATE OF amount, advance_paid, status, pay_at_hotel
  ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.bookings_derive_payment_status();