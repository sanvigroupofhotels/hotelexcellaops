
-- 1. Quote override parity columns
ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS total_override numeric,
  ADD COLUMN IF NOT EXISTS taxes_included boolean NOT NULL DEFAULT true;

-- 2. Guest Portal booking fields
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS expected_arrival_at timestamptz,
  ADD COLUMN IF NOT EXISTS emergency_contact_name text,
  ADD COLUMN IF NOT EXISTS emergency_contact_phone text,
  ADD COLUMN IF NOT EXISTS special_requests text;

-- 3. In-House Charges table
CREATE TABLE IF NOT EXISTS public.booking_charges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  category text NOT NULL,
  other_description text,
  quantity numeric NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price numeric NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  amount numeric NOT NULL DEFAULT 0,
  added_by text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.booking_charges TO authenticated;
GRANT ALL ON public.booking_charges TO service_role;

ALTER TABLE public.booking_charges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view booking charges"
  ON public.booking_charges FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can insert booking charges"
  ON public.booking_charges FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated can update booking charges"
  ON public.booking_charges FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Admins can delete booking charges"
  ON public.booking_charges FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER booking_charges_set_updated_at
  BEFORE UPDATE ON public.booking_charges
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_booking_charges_booking ON public.booking_charges(booking_id);

-- 4. Seed default In-House Charge Categories in master_data
INSERT INTO public.master_data (category, value, label, sort_order, active)
VALUES
  ('in_house_charge', 'Food Order', 'Food Order', 10, true),
  ('in_house_charge', 'Water Bottles', 'Water Bottles', 20, true),
  ('in_house_charge', 'Laundry', 'Laundry', 30, true),
  ('in_house_charge', 'Dental Kit', 'Dental Kit', 40, true),
  ('in_house_charge', 'Shaving Kit', 'Shaving Kit', 50, true),
  ('in_house_charge', 'Coffee', 'Coffee', 60, true),
  ('in_house_charge', 'Tea', 'Tea', 70, true),
  ('in_house_charge', 'Late Check-out', 'Late Check-out', 80, true),
  ('in_house_charge', 'Early Check-in', 'Early Check-in', 90, true),
  ('in_house_charge', 'Extra Pet', 'Extra Pet', 100, true),
  ('in_house_charge', 'Extra Adult', 'Extra Adult', 110, true),
  ('in_house_charge', 'Transportation', 'Transportation', 120, true),
  ('in_house_charge', 'Other', 'Other', 999, true)
ON CONFLICT DO NOTHING;
