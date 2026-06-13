
-- 1. Add resolver tracking to complaints
ALTER TABLE public.complaints
  ADD COLUMN IF NOT EXISTS resolved_by_staff_id uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS resolved_by_name text;

-- 2. Backfill cash_transactions.booking_payment_id by matching on booking_id + amount.
--    Only updates rows that currently have NO linkage and where there's exactly ONE matching booking_payment.
WITH candidates AS (
  SELECT ct.id AS tx_id, bp.id AS bp_id,
         row_number() OVER (PARTITION BY ct.id ORDER BY bp.occurred_at) AS rn,
         count(*) OVER (PARTITION BY ct.id) AS cnt
  FROM public.cash_transactions ct
  JOIN public.booking_payments bp
    ON bp.booking_id = ct.booking_id
   AND bp.amount = ct.amount
   AND lower(bp.payment_mode) = 'cash'
  WHERE ct.booking_payment_id IS NULL
    AND ct.booking_id IS NOT NULL
    AND ct.kind = 'collection'
)
UPDATE public.cash_transactions ct
   SET booking_payment_id = c.bp_id
  FROM candidates c
 WHERE ct.id = c.tx_id AND c.rn = 1 AND c.cnt = 1;

-- 3. Harden the sync trigger so that even rows without booking_payment_id linkage
--    get cleaned/created correctly on mode flips.
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
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.cash_transactions WHERE booking_payment_id = OLD.id;
    RETURN OLD;
  END IF;

  v_is_cash := lower(NEW.payment_mode) = 'cash';

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
      NEW.user_id, NEW.user_id, 'collection', 'Advance Payment',
      v_booking.guest_name, v_booking.phone, NEW.booking_id, NEW.customer_id,
      v_staff_id, NEW.collected_by, NEW.amount,
      COALESCE(NEW.notes, '') || ' [auto-from booking payment ' || COALESCE(v_booking.booking_reference,'') || ']',
      NEW.occurred_at, NEW.id
    );
    RETURN NEW;
  END IF;

  -- UPDATE branch
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
          staff_id = v_staff_id, staff_name = NEW.collected_by,
          guest_name = v_booking.guest_name, guest_mobile = v_booking.phone,
          customer_id = NEW.customer_id,
          notes = COALESCE(NEW.notes,'') || ' [auto-from booking payment ' || COALESCE(v_booking.booking_reference,'') || ']',
          modified_by = NEW.user_id, active = true
      WHERE id = v_existing;
    ELSE
      INSERT INTO public.cash_transactions(
        user_id, modified_by, kind, type_name,
        guest_name, guest_mobile, booking_id, customer_id,
        staff_id, staff_name, amount, notes, occurred_at, booking_payment_id
      ) VALUES (
        NEW.user_id, NEW.user_id, 'collection', 'Advance Payment',
        v_booking.guest_name, v_booking.phone, NEW.booking_id, NEW.customer_id,
        v_staff_id, NEW.collected_by, NEW.amount,
        COALESCE(NEW.notes,'') || ' [auto-from booking payment ' || COALESCE(v_booking.booking_reference,'') || ']',
        NEW.occurred_at, NEW.id
      );
    END IF;
  ELSE
    -- Mode is no longer cash; remove linked entry. Also try to clean any legacy
    -- cash row that was created for THIS booking_payment but never linked.
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
