
-- =====================================================================
-- Shipment 2 — Inventory Auto-Consumption Engine (idempotent, ledger-based)
-- Single source of truth: sync_inventory_for_charge(charge_id).
-- Uses inventory_movements as the append-only ledger; deltas are diffs
-- against the current target state so triggers can fire repeatedly
-- (new / update / delete / re-cancel / uncancel) with the ledger
-- always converging to the correct balance.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.sync_inventory_for_charge(p_charge_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_charge          public.booking_charges%ROWTYPE;
  v_charge_exists   boolean := false;
  v_booking_status  text;
  v_target_item     uuid;
  v_auto_qty        numeric;
  v_target_delta    numeric := 0;   -- signed target for the current item (0 if none)
  r                 record;
  v_existing        numeric;
  v_diff            numeric;
  v_notes           text;
BEGIN
  SELECT * INTO v_charge FROM public.booking_charges WHERE id = p_charge_id;
  IF FOUND THEN
    v_charge_exists := true;
    SELECT status::text INTO v_booking_status
      FROM public.bookings WHERE id = v_charge.booking_id;

    IF COALESCE(v_booking_status,'') NOT IN ('Cancelled','No-Show') THEN
      SELECT inventory_item_id, COALESCE(NULLIF(auto_consume_qty,0), 1)
        INTO v_target_item, v_auto_qty
        FROM public.charge_catalog
       WHERE label = v_charge.category
         AND active = true
         AND inventory_item_id IS NOT NULL
       LIMIT 1;

      IF v_target_item IS NOT NULL THEN
        v_target_delta := -(v_auto_qty * COALESCE(v_charge.quantity, 0));
      END IF;
    END IF;
  END IF;

  v_notes := CASE
    WHEN v_charge_exists THEN 'Auto-consume · ' || COALESCE(v_charge.category,'')
    ELSE 'Auto-consume reversal (charge removed)'
  END;

  -- 1) For every item that has an outstanding balance for this charge but is
  --    NOT the current target, insert a compensating movement to zero it out.
  FOR r IN
    SELECT item_id, SUM(delta) AS bal
      FROM public.inventory_movements
     WHERE source_type = 'booking_charge'
       AND source_id   = p_charge_id
       AND reason      = 'auto_charge'
     GROUP BY item_id
    HAVING SUM(delta) <> 0
  LOOP
    IF v_target_item IS NULL OR r.item_id IS DISTINCT FROM v_target_item THEN
      INSERT INTO public.inventory_movements(
        item_id, delta, reason, source_type, source_id, notes
      ) VALUES (
        r.item_id, -r.bal, 'auto_charge', 'booking_charge', p_charge_id, v_notes
      );
    END IF;
  END LOOP;

  -- 2) For the current target item, top up (or refund) to the target delta.
  IF v_target_item IS NOT NULL THEN
    SELECT COALESCE(SUM(delta),0) INTO v_existing
      FROM public.inventory_movements
     WHERE source_type = 'booking_charge'
       AND source_id   = p_charge_id
       AND reason      = 'auto_charge'
       AND item_id     = v_target_item;

    v_diff := v_target_delta - v_existing;
    IF v_diff <> 0 THEN
      INSERT INTO public.inventory_movements(
        item_id, delta, reason, source_type, source_id, notes
      ) VALUES (
        v_target_item, v_diff, 'auto_charge', 'booking_charge', p_charge_id, v_notes
      );
    END IF;
  END IF;
END
$fn$;

REVOKE ALL ON FUNCTION public.sync_inventory_for_charge(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_inventory_for_charge(uuid) TO authenticated, service_role;

-- ---------- booking_charges triggers ----------
CREATE OR REPLACE FUNCTION public.booking_charges_after_write_sync_inventory()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.sync_inventory_for_charge(OLD.id);
    RETURN OLD;
  ELSE
    PERFORM public.sync_inventory_for_charge(NEW.id);
    RETURN NEW;
  END IF;
END $$;

DROP TRIGGER IF EXISTS booking_charges_sync_inventory ON public.booking_charges;
CREATE TRIGGER booking_charges_sync_inventory
AFTER INSERT OR UPDATE OR DELETE ON public.booking_charges
FOR EACH ROW EXECUTE FUNCTION public.booking_charges_after_write_sync_inventory();

-- ---------- bookings status trigger (cancel / uncancel cascades) ----------
CREATE OR REPLACE FUNCTION public.bookings_after_status_sync_inventory()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    IF NEW.status::text IN ('Cancelled','No-Show')
       OR OLD.status::text IN ('Cancelled','No-Show') THEN
      FOR r IN SELECT id FROM public.booking_charges WHERE booking_id = NEW.id LOOP
        PERFORM public.sync_inventory_for_charge(r.id);
      END LOOP;
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS bookings_sync_inventory_on_status ON public.bookings;
CREATE TRIGGER bookings_sync_inventory_on_status
AFTER UPDATE OF status ON public.bookings
FOR EACH ROW EXECUTE FUNCTION public.bookings_after_status_sync_inventory();

-- ---------- Backfill existing charges so the ledger reflects current state ----------
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.booking_charges LOOP
    PERFORM public.sync_inventory_for_charge(r.id);
  END LOOP;
END $$;
