
-- 1) booking_payments: refund flag + reason
ALTER TABLE public.booking_payments
  ADD COLUMN IF NOT EXISTS is_refund boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS refund_reason text;

-- 2) bookings: convenience summary for the cancel-time refund
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS cancel_refund_amount numeric,
  ADD COLUMN IF NOT EXISTS cancel_refund_mode text,
  ADD COLUMN IF NOT EXISTS cancel_refund_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancel_reason text;

-- 3) recompute_booking_advance: subtract refunds
CREATE OR REPLACE FUNCTION public.recompute_booking_advance(p_booking_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.bookings b
  SET advance_paid = COALESCE((
    SELECT
      SUM(CASE WHEN COALESCE(is_refund,false) THEN -amount ELSE amount END)
    FROM public.booking_payments
    WHERE booking_id = p_booking_id
  ), 0)
  WHERE b.id = p_booking_id;
END $function$;

-- 4) booking_payments_sync_cash: refund-aware
--    Refund + mode=Cash  -> cash_transactions row of kind='expense'
--    Normal + mode=Cash  -> cash_transactions row of kind='collection' (existing behavior)
CREATE OR REPLACE FUNCTION public.booking_payments_sync_cash()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_booking record;
  v_staff_id uuid;
  v_was_cash boolean;
  v_is_cash boolean;
  v_existing uuid;
  v_kind text;
  v_type text;
  v_tag text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.cash_transactions WHERE booking_payment_id = OLD.id;
    RETURN OLD;
  END IF;

  v_is_cash := lower(NEW.payment_mode) = 'cash';
  v_kind := CASE WHEN COALESCE(NEW.is_refund,false) THEN 'expense' ELSE 'collection' END;
  v_type := CASE WHEN COALESCE(NEW.is_refund,false) THEN 'Refund' ELSE 'Advance Payment' END;
  v_tag  := CASE WHEN COALESCE(NEW.is_refund,false) THEN 'refund' ELSE 'booking payment' END;

  IF TG_OP = 'INSERT' THEN
    IF NOT v_is_cash THEN RETURN NEW; END IF;
    SELECT b.guest_name, b.phone, b.booking_reference, b.customer_id
      INTO v_booking FROM public.bookings b WHERE b.id = NEW.booking_id;
    SELECT id INTO v_staff_id FROM public.staff
      WHERE lower(name) = lower(NEW.collected_by) AND active = true
      ORDER BY created_at LIMIT 1;
    INSERT INTO public.cash_transactions(
      user_id, modified_by, kind, type_name,
      guest_name, guest_mobile, booking_id, customer_id,
      staff_id, staff_name, amount, notes, occurred_at, booking_payment_id
    ) VALUES (
      NEW.user_id, NEW.user_id, v_kind, v_type,
      v_booking.guest_name, v_booking.phone, NEW.booking_id, NEW.customer_id,
      v_staff_id, NEW.collected_by, NEW.amount,
      COALESCE(NEW.notes, '') || ' [auto-from ' || v_tag || ' ' || COALESCE(v_booking.booking_reference,'') || ']',
      NEW.occurred_at, NEW.id
    );
    RETURN NEW;
  END IF;

  v_was_cash := lower(OLD.payment_mode) = 'cash';
  SELECT id INTO v_existing FROM public.cash_transactions WHERE booking_payment_id = NEW.id LIMIT 1;

  IF v_is_cash THEN
    SELECT b.guest_name, b.phone, b.booking_reference, b.customer_id
      INTO v_booking FROM public.bookings b WHERE b.id = NEW.booking_id;
    SELECT id INTO v_staff_id FROM public.staff
      WHERE lower(name) = lower(NEW.collected_by) AND active = true
      ORDER BY created_at LIMIT 1;

    IF v_existing IS NOT NULL THEN
      UPDATE public.cash_transactions
      SET amount = NEW.amount, occurred_at = NEW.occurred_at,
          kind = v_kind, type_name = v_type,
          staff_id = v_staff_id, staff_name = NEW.collected_by,
          guest_name = v_booking.guest_name, guest_mobile = v_booking.phone,
          customer_id = NEW.customer_id,
          notes = COALESCE(NEW.notes,'') || ' [auto-from ' || v_tag || ' ' || COALESCE(v_booking.booking_reference,'') || ']',
          modified_by = NEW.user_id, active = true
      WHERE id = v_existing;
    ELSE
      INSERT INTO public.cash_transactions(
        user_id, modified_by, kind, type_name,
        guest_name, guest_mobile, booking_id, customer_id,
        staff_id, staff_name, amount, notes, occurred_at, booking_payment_id
      ) VALUES (
        NEW.user_id, NEW.user_id, v_kind, v_type,
        v_booking.guest_name, v_booking.phone, NEW.booking_id, NEW.customer_id,
        v_staff_id, NEW.collected_by, NEW.amount,
        COALESCE(NEW.notes,'') || ' [auto-from ' || v_tag || ' ' || COALESCE(v_booking.booking_reference,'') || ']',
        NEW.occurred_at, NEW.id
      );
    END IF;
  ELSE
    IF v_existing IS NOT NULL THEN
      DELETE FROM public.cash_transactions WHERE id = v_existing;
    ELSIF v_was_cash THEN
      DELETE FROM public.cash_transactions
       WHERE booking_payment_id IS NULL
         AND booking_id = OLD.booking_id
         AND amount = OLD.amount
         AND abs(extract(epoch from (occurred_at - OLD.occurred_at))) < 60;
    END IF;
  END IF;
  RETURN NEW;
END $function$;
