
-- ============================================================
-- TURN 5: Multi-line quotes, Bookings, Customer maturity
-- ============================================================

-- ---------- 1. CUSTOMERS: company_address ----------
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS company_address text;

-- ---------- 2. QUOTE_ITEMS ----------
CREATE TABLE IF NOT EXISTS public.quote_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id uuid NOT NULL REFERENCES public.quotes(id) ON DELETE CASCADE,
  position int NOT NULL DEFAULT 0,
  room_type text NOT NULL DEFAULT 'Standard Room',
  adults int NOT NULL DEFAULT 2,
  children int NOT NULL DEFAULT 0,
  check_in date NOT NULL,
  check_out date NOT NULL,
  nights int GENERATED ALWAYS AS (GREATEST((check_out - check_in), 1)) STORED,
  breakfast_included boolean NOT NULL DEFAULT true,
  extra_bed int NOT NULL DEFAULT 0,
  rate numeric NOT NULL DEFAULT 0,
  subtotal numeric NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_quote_items_quote_id ON public.quote_items(quote_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.quote_items TO authenticated;
GRANT ALL ON public.quote_items TO service_role;

ALTER TABLE public.quote_items ENABLE ROW LEVEL SECURITY;

-- Shared-team read (mirrors quotes)
CREATE POLICY quote_items_select_all ON public.quote_items
  FOR SELECT TO authenticated USING (true);

-- Insert/update/delete gated by parent quote ownership
CREATE POLICY quote_items_insert_own_parent ON public.quote_items
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.quotes q WHERE q.id = quote_id AND q.user_id = auth.uid()));

CREATE POLICY quote_items_update_own_parent ON public.quote_items
  FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (EXISTS (SELECT 1 FROM public.quotes q WHERE q.id = quote_id AND q.user_id = auth.uid()));

CREATE POLICY quote_items_delete_own_parent ON public.quote_items
  FOR DELETE TO authenticated
  USING (is_admin() OR EXISTS (SELECT 1 FROM public.quotes q WHERE q.id = quote_id AND q.user_id = auth.uid()));

CREATE TRIGGER quote_items_set_updated_at
  BEFORE UPDATE ON public.quote_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Backfill: one line item per existing quote
INSERT INTO public.quote_items
  (quote_id, position, room_type, adults, children, check_in, check_out, breakfast_included, extra_bed, rate, subtotal)
SELECT q.id, 0,
  COALESCE(q.room_type, 'Standard Room'),
  q.adults, q.children, q.check_in, q.check_out,
  q.breakfast_included, q.extra_bed, q.room_rate, q.subtotal
FROM public.quotes q
WHERE NOT EXISTS (SELECT 1 FROM public.quote_items qi WHERE qi.quote_id = q.id);

-- ---------- 3. BOOKINGS ----------
DO $$ BEGIN
  CREATE TYPE public.booking_status AS ENUM ('Draft','Confirmed','Cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  source_quote_id uuid REFERENCES public.quotes(id) ON DELETE SET NULL,
  booking_reference text NOT NULL DEFAULT ('HEXB-' || upper(substring(md5(random()::text), 1, 6))),
  guest_name text NOT NULL,
  phone text,
  email text,
  check_in date NOT NULL,
  check_out date NOT NULL,
  nights int GENERATED ALWAYS AS (GREATEST((check_out - check_in), 1)) STORED,
  adults int NOT NULL DEFAULT 2,
  children int NOT NULL DEFAULT 0,
  guests int NOT NULL DEFAULT 2,
  room_details text,
  amount numeric NOT NULL DEFAULT 0,
  notes text,
  internal_notes text,
  status public.booking_status NOT NULL DEFAULT 'Draft',
  payment_status text NOT NULL DEFAULT 'None',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bookings_customer_id ON public.bookings(customer_id);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON public.bookings(status);
CREATE INDEX IF NOT EXISTS idx_bookings_check_in ON public.bookings(check_in);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.bookings TO authenticated;
GRANT ALL ON public.bookings TO service_role;

ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;

CREATE POLICY bookings_select_all ON public.bookings
  FOR SELECT TO authenticated USING (true);

CREATE POLICY bookings_insert_auth ON public.bookings
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY bookings_update_auth ON public.bookings
  FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (user_id = (SELECT b.user_id FROM public.bookings b WHERE b.id = bookings.id));

CREATE POLICY bookings_delete_admin ON public.bookings
  FOR DELETE TO authenticated
  USING (is_admin());

CREATE TRIGGER bookings_set_updated_at
  BEFORE UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Recompute total_bookings on customers when bookings change
CREATE OR REPLACE FUNCTION public.recompute_customer_bookings(p_customer_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF p_customer_id IS NULL THEN RETURN; END IF;
  UPDATE public.customers c
  SET total_bookings = COALESCE(sub.cnt, 0)
  FROM (
    SELECT COUNT(*)::int AS cnt
    FROM public.bookings
    WHERE customer_id = p_customer_id
      AND status IN ('Draft','Confirmed')
  ) sub
  WHERE c.id = p_customer_id;
END; $$;

CREATE OR REPLACE FUNCTION public.bookings_after_change_update_customer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.recompute_customer_bookings(COALESCE(NEW.customer_id, OLD.customer_id));
  RETURN NULL;
END; $$;

CREATE TRIGGER bookings_recompute_customer
  AFTER INSERT OR UPDATE OR DELETE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.bookings_after_change_update_customer();

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.quote_items;
ALTER PUBLICATION supabase_realtime ADD TABLE public.bookings;
