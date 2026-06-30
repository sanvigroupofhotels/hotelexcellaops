
-- =====================================================================
-- Operations Module · Shipment 1 · Foundation
-- =====================================================================

-- ---------- 1. Seed Master Data: inventory_category ----------
INSERT INTO public.master_data (category, value, label, sort_order, active) VALUES
  ('inventory_category', 'beverages',            'Beverages',             10, true),
  ('inventory_category', 'toiletries',           'Toiletries',            20, true),
  ('inventory_category', 'cleaning',             'Cleaning',              30, true),
  ('inventory_category', 'kitchenware',          'Kitchenware',           40, true),
  ('inventory_category', 'housekeeping_supplies','Housekeeping Supplies', 50, true),
  ('inventory_category', 'disposables',          'Disposables',           60, true)
ON CONFLICT DO NOTHING;

-- ---------- 2. Vendors ----------
CREATE TABLE IF NOT EXISTS public.vendors (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  name            text NOT NULL,
  contact_person  text NOT NULL,
  phone           text NOT NULL,
  alt_phones      text[] NOT NULL DEFAULT '{}',
  address         text,
  maps_url        text,
  notes           text,
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vendors_active_idx ON public.vendors(active);
CREATE INDEX IF NOT EXISTS vendors_name_idx   ON public.vendors(lower(name));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.vendors TO authenticated;
GRANT ALL ON public.vendors TO service_role;

ALTER TABLE public.vendors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Vendors readable by authenticated"
  ON public.vendors FOR SELECT TO authenticated USING (true);
CREATE POLICY "Vendors insertable by authenticated"
  ON public.vendors FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Vendors updatable by authenticated"
  ON public.vendors FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Vendors deletable by admin or owner"
  ON public.vendors FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'owner'));

CREATE TRIGGER vendors_set_updated_at
  BEFORE UPDATE ON public.vendors
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Normalize phone numbers on insert/update using existing helper.
CREATE OR REPLACE FUNCTION public.vendors_normalize_phone()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p text; cleaned text[]; i text;
BEGIN
  p := public.normalize_phone_in(NEW.phone);
  IF p IS NOT NULL THEN NEW.phone := p; END IF;
  cleaned := '{}';
  IF NEW.alt_phones IS NOT NULL THEN
    FOREACH i IN ARRAY NEW.alt_phones LOOP
      p := public.normalize_phone_in(i);
      IF p IS NOT NULL THEN cleaned := array_append(cleaned, p); END IF;
    END LOOP;
  END IF;
  NEW.alt_phones := cleaned;
  RETURN NEW;
END $$;

CREATE TRIGGER vendors_normalize_phone_trg
  BEFORE INSERT OR UPDATE OF phone, alt_phones ON public.vendors
  FOR EACH ROW EXECUTE FUNCTION public.vendors_normalize_phone();

-- ---------- 3. Charge Catalog ----------
CREATE TABLE IF NOT EXISTS public.charge_catalog (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  key            text NOT NULL UNIQUE,
  label          text NOT NULL,
  default_price  numeric NOT NULL DEFAULT 0,
  taxable        boolean NOT NULL DEFAULT false,
  sort_order     int NOT NULL DEFAULT 100,
  active         boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS charge_catalog_active_idx ON public.charge_catalog(active);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.charge_catalog TO authenticated;
GRANT ALL ON public.charge_catalog TO service_role;

ALTER TABLE public.charge_catalog ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Charge catalog readable by authenticated"
  ON public.charge_catalog FOR SELECT TO authenticated USING (true);
CREATE POLICY "Charge catalog insertable by authenticated"
  ON public.charge_catalog FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Charge catalog updatable by authenticated"
  ON public.charge_catalog FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Charge catalog deletable by admin or owner"
  ON public.charge_catalog FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'owner'));

CREATE TRIGGER charge_catalog_set_updated_at
  BEFORE UPDATE ON public.charge_catalog
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Seed common catalog entries (idempotent).
INSERT INTO public.charge_catalog (key, label, default_price, sort_order) VALUES
  ('water_bottle',  'Water Bottle',     20,  10),
  ('tea',           'Tea',              30,  20),
  ('coffee',        'Coffee',           40,  30),
  ('early_checkin', 'Early Check-In',    0,  40),
  ('late_checkout', 'Late Check-Out',    0,  50),
  ('pet_charge',    'Pet Charge',      750,  60),
  ('extra_adult',   'Extra Adult',     500,  70),
  ('extra_bed',     'Extra Bed',       500,  80),
  ('laundry',       'Laundry',           0,  90),
  ('other',         'Other',             0, 990)
ON CONFLICT (key) DO NOTHING;

-- ---------- 4. Inventory Items ----------
CREATE TABLE IF NOT EXISTS public.inventory_items (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  name                        text NOT NULL,
  photo_path                  text,
  category_value              text,
  preferred_vendor_id         uuid REFERENCES public.vendors(id) ON DELETE SET NULL,
  unit                        text NOT NULL DEFAULT 'piece',
  current_stock               numeric NOT NULL DEFAULT 0,
  minimum_stock               numeric NOT NULL DEFAULT 0,
  auto_consume_catalog_key    text REFERENCES public.charge_catalog(key) ON UPDATE CASCADE ON DELETE SET NULL,
  housekeeping_per_room       numeric,
  active                      boolean NOT NULL DEFAULT true,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS inventory_items_name_uniq_ci ON public.inventory_items(lower(name));
CREATE INDEX IF NOT EXISTS inventory_items_active_idx ON public.inventory_items(active);
CREATE INDEX IF NOT EXISTS inventory_items_low_idx   ON public.inventory_items((current_stock <= minimum_stock));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.inventory_items TO authenticated;
GRANT ALL ON public.inventory_items TO service_role;

ALTER TABLE public.inventory_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Inventory items readable by authenticated"
  ON public.inventory_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "Inventory items insertable by authenticated"
  ON public.inventory_items FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Inventory items updatable by authenticated"
  ON public.inventory_items FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Inventory items deletable by admin or owner"
  ON public.inventory_items FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'owner'));

CREATE TRIGGER inventory_items_set_updated_at
  BEFORE UPDATE ON public.inventory_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------- 5. Inventory Movements (append-only ledger) ----------
DO $$ BEGIN
  CREATE TYPE public.inventory_movement_reason AS ENUM (
    'stock_in',
    'stock_out',
    'auto_charge',
    'auto_housekeeping',
    'reconciliation_adjust',
    'wastage',
    'correction'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.inventory_movements (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  item_id          uuid NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  delta            numeric NOT NULL,
  reason           public.inventory_movement_reason NOT NULL,
  source_type      text,
  source_id        uuid,
  unit_cost        numeric,
  vendor_id        uuid REFERENCES public.vendors(id) ON DELETE SET NULL,
  notes            text,
  actor_id         uuid,
  actor_name       text,
  actor_role       text,
  batch_id         uuid,
  correlation_id   uuid,
  occurred_at      timestamptz NOT NULL DEFAULT now(),
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inv_mov_item_idx       ON public.inventory_movements(item_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS inv_mov_occurred_idx   ON public.inventory_movements(occurred_at DESC);
CREATE INDEX IF NOT EXISTS inv_mov_source_idx     ON public.inventory_movements(source_type, source_id);
CREATE INDEX IF NOT EXISTS inv_mov_batch_idx      ON public.inventory_movements(batch_id);

GRANT SELECT, INSERT ON public.inventory_movements TO authenticated;
GRANT ALL ON public.inventory_movements TO service_role;

ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Inventory movements readable by authenticated"
  ON public.inventory_movements FOR SELECT TO authenticated USING (true);
CREATE POLICY "Inventory movements insertable by authenticated"
  ON public.inventory_movements FOR INSERT TO authenticated WITH CHECK (true);

-- Stamp actor + apply delta to cached current_stock
CREATE OR REPLACE FUNCTION public.inventory_movements_before_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a record;
BEGIN
  IF NEW.actor_id IS NULL OR NEW.actor_name IS NULL OR NEW.actor_role IS NULL THEN
    SELECT * INTO a FROM public.current_actor();
    IF NEW.actor_id   IS NULL THEN NEW.actor_id   := a.uid; END IF;
    IF NEW.actor_name IS NULL THEN NEW.actor_name := a.display_name; END IF;
    IF NEW.actor_role IS NULL THEN NEW.actor_role := a.role; END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER inventory_movements_before_insert_trg
  BEFORE INSERT ON public.inventory_movements
  FOR EACH ROW EXECUTE FUNCTION public.inventory_movements_before_insert();

CREATE OR REPLACE FUNCTION public.inventory_movements_apply_delta()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.inventory_items
     SET current_stock = COALESCE(current_stock,0) + NEW.delta,
         updated_at = now()
   WHERE id = NEW.item_id;
  RETURN NEW;
END $$;

CREATE TRIGGER inventory_movements_apply_delta_trg
  AFTER INSERT ON public.inventory_movements
  FOR EACH ROW EXECUTE FUNCTION public.inventory_movements_apply_delta();

-- Recompute helper (Night Audit / drift correction).
CREATE OR REPLACE FUNCTION public.recompute_inventory_stock(p_item_id uuid)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v numeric;
BEGIN
  SELECT COALESCE(SUM(delta),0) INTO v
    FROM public.inventory_movements WHERE item_id = p_item_id;
  UPDATE public.inventory_items
     SET current_stock = v, updated_at = now()
   WHERE id = p_item_id;
  RETURN v;
END $$;

-- ---------- 6. Storage cleanup trigger for inventory photos ----------
CREATE OR REPLACE FUNCTION public.inventory_items_delete_photo()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.photo_path IS NOT NULL THEN
    DELETE FROM storage.objects WHERE bucket_id = 'inventory-photos' AND name = OLD.photo_path;
  END IF;
  RETURN OLD;
END $$;

CREATE TRIGGER inventory_items_delete_photo_trg
  AFTER DELETE ON public.inventory_items
  FOR EACH ROW EXECUTE FUNCTION public.inventory_items_delete_photo();
