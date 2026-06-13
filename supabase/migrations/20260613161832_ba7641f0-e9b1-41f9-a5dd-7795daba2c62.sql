
-- 1) Link cash_transactions to booking_payments for full lifecycle sync
ALTER TABLE public.cash_transactions ADD COLUMN IF NOT EXISTS booking_payment_id uuid;
CREATE INDEX IF NOT EXISTS cashtx_booking_payment_id_idx ON public.cash_transactions(booking_payment_id);

-- Backfill: link existing auto-created Advance Payment rows to their booking_payment by booking_id + amount + occurred_at
UPDATE public.cash_transactions ct
SET booking_payment_id = bp.id
FROM public.booking_payments bp
WHERE ct.booking_payment_id IS NULL
  AND ct.booking_id = bp.booking_id
  AND ct.kind = 'collection'
  AND ct.type_name = 'Advance Payment'
  AND lower(bp.payment_mode) = 'cash'
  AND ct.amount = bp.amount
  AND abs(extract(epoch from (ct.occurred_at - bp.occurred_at))) < 60;

-- 2) Replace sync trigger to cover INSERT/UPDATE/DELETE and payment_mode flips
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
      INTO v_booking
      FROM public.bookings b WHERE b.id = NEW.booking_id;
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
      INTO v_booking
      FROM public.bookings b WHERE b.id = NEW.booking_id;
    SELECT id INTO v_staff_id FROM public.staff
      WHERE lower(name) = lower(NEW.collected_by) AND active = true
      ORDER BY created_at LIMIT 1;

    IF v_existing IS NOT NULL THEN
      UPDATE public.cash_transactions
      SET amount = NEW.amount,
          occurred_at = NEW.occurred_at,
          staff_id = v_staff_id,
          staff_name = NEW.collected_by,
          guest_name = v_booking.guest_name,
          guest_mobile = v_booking.phone,
          customer_id = NEW.customer_id,
          notes = COALESCE(NEW.notes,'') || ' [auto-from booking payment ' || COALESCE(v_booking.booking_reference,'') || ']',
          modified_by = NEW.user_id,
          active = true
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
    -- Mode is no longer cash; remove any linked cash entry
    IF v_existing IS NOT NULL THEN
      DELETE FROM public.cash_transactions WHERE id = v_existing;
    END IF;
  END IF;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_booking_payments_sync_cash ON public.booking_payments;
CREATE TRIGGER trg_booking_payments_sync_cash
  AFTER INSERT OR UPDATE OR DELETE ON public.booking_payments
  FOR EACH ROW EXECUTE FUNCTION public.booking_payments_sync_cash();

-- 3) Issues unification: extend complaints
ALTER TABLE public.complaints
  ADD COLUMN IF NOT EXISTS issue_type text,
  ADD COLUMN IF NOT EXISTS guest_impacted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS resolution_notes text,
  ADD COLUMN IF NOT EXISTS closed_at timestamptz;

-- Stamp closed_at when status becomes Resolved (extend existing audit logic via trigger function tweak)
CREATE OR REPLACE FUNCTION public.complaints_stamp_closed()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.status = 'Resolved' AND (OLD.status IS DISTINCT FROM NEW.status) AND NEW.closed_at IS NULL THEN
    NEW.closed_at := now();
  ELSIF NEW.status <> 'Resolved' AND OLD.status = 'Resolved' THEN
    NEW.closed_at := NULL;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_complaints_stamp_closed ON public.complaints;
CREATE TRIGGER trg_complaints_stamp_closed
  BEFORE UPDATE ON public.complaints
  FOR EACH ROW EXECUTE FUNCTION public.complaints_stamp_closed();
