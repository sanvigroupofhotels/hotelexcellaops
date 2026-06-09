
-- ============================================================
-- P1: Fix booking_items RLS — align with bookings (multi-staff)
-- ============================================================
DROP POLICY IF EXISTS booking_items_insert_own_parent ON public.booking_items;
DROP POLICY IF EXISTS booking_items_update_own_parent ON public.booking_items;
DROP POLICY IF EXISTS booking_items_delete_own_parent ON public.booking_items;

CREATE POLICY booking_items_insert_auth ON public.booking_items
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.bookings b WHERE b.id = booking_items.booking_id));

CREATE POLICY booking_items_update_auth ON public.booking_items
  FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (EXISTS (SELECT 1 FROM public.bookings b WHERE b.id = booking_items.booking_id));

CREATE POLICY booking_items_delete_auth ON public.booking_items
  FOR DELETE TO authenticated
  USING (is_admin() OR EXISTS (SELECT 1 FROM public.bookings b WHERE b.id = booking_items.booking_id));

-- ============================================================
-- P2: Remove "Stay Completed" — backfill to Checked-Out
-- ============================================================
UPDATE public.bookings SET status = 'Checked-Out' WHERE status = 'Stay Completed';

-- Update sweep function to use Checked-Out
CREATE OR REPLACE FUNCTION public.sweep_stay_completed()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  WITH upd AS (
    UPDATE public.bookings
    SET status = 'Checked-Out'::booking_status
    WHERE status = 'Checked-In'::booking_status
      AND (check_out::timestamp + interval '17 hours') < now()
    RETURNING 1
  ) SELECT count(*) INTO n FROM upd;
  RETURN COALESCE(n, 0);
END $$;

-- Update recompute_customer_bookings to drop Stay Completed
CREATE OR REPLACE FUNCTION public.recompute_customer_bookings(p_customer_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_customer_id IS NULL THEN RETURN; END IF;
  UPDATE public.customers c
  SET total_bookings = COALESCE(sub.cnt, 0),
      last_stay_date = sub.last_stay
  FROM (
    SELECT
      COUNT(*) FILTER (WHERE status IN ('Draft','Confirmed','Advance Paid','Full Paid','Checked-In','Checked-Out'))::int AS cnt,
      MAX(check_out) FILTER (WHERE status = 'Checked-Out' OR (status IN ('Confirmed','Advance Paid','Full Paid') AND check_out < CURRENT_DATE)) AS last_stay
    FROM public.bookings
    WHERE customer_id = p_customer_id
  ) sub
  WHERE c.id = p_customer_id;
END $$;

-- Auto-derive payment status (Pending/Advance Paid/Full Paid) on booking save when not in Checked-In/Out/Cancelled
CREATE OR REPLACE FUNCTION public.bookings_derive_payment_status()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  -- Only auto-derive when status is still in the pre-checkin payment lifecycle
  IF NEW.status IN ('Pending', 'Confirmed', 'Advance Paid', 'Full Paid', 'Draft') THEN
    IF COALESCE(NEW.advance_paid, 0) <= 0 THEN
      NEW.status := 'Pending'::booking_status;
    ELSIF COALESCE(NEW.advance_paid, 0) >= NEW.amount THEN
      NEW.status := 'Full Paid'::booking_status;
    ELSE
      NEW.status := 'Advance Paid'::booking_status;
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_bookings_derive_payment_status ON public.bookings;
CREATE TRIGGER trg_bookings_derive_payment_status
  BEFORE INSERT OR UPDATE OF amount, advance_paid, status ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.bookings_derive_payment_status();

-- ============================================================
-- P6: Auto-create Cash Collection when booking_payment mode = Cash
-- ============================================================
CREATE OR REPLACE FUNCTION public.booking_payments_sync_cash()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_booking record;
  v_staff_id uuid;
BEGIN
  IF TG_OP = 'INSERT' AND lower(NEW.payment_mode) = 'cash' THEN
    SELECT b.guest_name, b.phone, b.booking_reference, b.customer_id
      INTO v_booking
    FROM public.bookings b WHERE b.id = NEW.booking_id;

    -- best-effort staff lookup by name
    SELECT id INTO v_staff_id FROM public.staff
      WHERE lower(name) = lower(NEW.collected_by) AND active = true
      ORDER BY created_at LIMIT 1;

    INSERT INTO public.cash_transactions(
      user_id, modified_by, kind, type_name,
      guest_name, guest_mobile, booking_id, customer_id,
      staff_id, staff_name, amount, notes, occurred_at
    ) VALUES (
      NEW.user_id, NEW.user_id, 'collection', 'Advance Payment',
      v_booking.guest_name, v_booking.phone, NEW.booking_id, NEW.customer_id,
      v_staff_id, NEW.collected_by, NEW.amount,
      COALESCE(NEW.notes, '') || ' [auto-from booking payment ' || v_booking.booking_reference || ']',
      NEW.occurred_at
    );
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_booking_payments_sync_cash ON public.booking_payments;
CREATE TRIGGER trg_booking_payments_sync_cash
  AFTER INSERT ON public.booking_payments
  FOR EACH ROW EXECUTE FUNCTION public.booking_payments_sync_cash();

-- ============================================================
-- P10: Room conflict protection (block non-admin overlap)
-- ============================================================
CREATE OR REPLACE FUNCTION public.bookings_prevent_room_conflict()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_conflict_count int;
BEGIN
  IF NEW.room_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.status IN ('Cancelled', 'Checked-Out') THEN RETURN NEW; END IF;
  IF is_admin() THEN RETURN NEW; END IF;

  SELECT count(*) INTO v_conflict_count
  FROM public.bookings b
  WHERE b.room_id = NEW.room_id
    AND b.id <> NEW.id
    AND b.status NOT IN ('Cancelled', 'Checked-Out')
    AND b.check_in < NEW.check_out
    AND NEW.check_in < b.check_out;

  IF v_conflict_count > 0 THEN
    RAISE EXCEPTION 'Room conflict: this room is already booked for an overlapping date range. Ask an admin to override.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_bookings_prevent_room_conflict ON public.bookings;
CREATE TRIGGER trg_bookings_prevent_room_conflict
  BEFORE INSERT OR UPDATE OF room_id, check_in, check_out, status ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.bookings_prevent_room_conflict();
