-- Charge Catalog becomes single source of truth for guest chargeable items.
-- Add optional inventory linkage for Shipment 2 auto-consume.
ALTER TABLE public.charge_catalog
  ADD COLUMN IF NOT EXISTS inventory_item_id uuid REFERENCES public.inventory_items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS auto_consume_qty numeric NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS charge_catalog_inventory_item_idx
  ON public.charge_catalog(inventory_item_id) WHERE inventory_item_id IS NOT NULL;

-- Seed common guest charges if catalog is empty so the Add Charge dropdown
-- has parity with the previous master_data defaults. Safe to re-run.
INSERT INTO public.charge_catalog (key, label, default_price, sort_order, active)
SELECT * FROM (VALUES
  ('water_bottle',     'Water Bottle',     0,  10, true),
  ('soft_drinks',      'Soft Drinks',      0,  20, true),
  ('food_order',       'Food Order',       0,  30, true),
  ('laundry',          'Laundry',          0,  40, true),
  ('extra_bed',        'Extra Bed',        0,  50, true),
  ('early_check_in',   'Early Check-in',   0,  60, true),
  ('late_check_out',   'Late Check-out',   0,  70, true),
  ('extra_adult',      'Extra Adult',      0,  80, true),
  ('extra_pet',        'Extra Pet',        0,  90, true),
  ('transportation',   'Transportation',   0, 100, true),
  ('printing',         'Printing Charges', 0, 110, true),
  ('dental_kit',       'Dental Kit',       0, 120, true),
  ('shaving_kit',      'Shaving Kit',      0, 130, true),
  ('coffee',           'Coffee',           0, 140, true),
  ('tea',              'Tea',              0, 150, true),
  ('other',            'Other',            0, 999, true)
) AS v(key, label, default_price, sort_order, active)
WHERE NOT EXISTS (SELECT 1 FROM public.charge_catalog WHERE charge_catalog.key = v.key);
