-- UAT-033: Multiple contact numbers per customer
-- A customer can have multiple mobile numbers, one marked primary. Duplicate
-- phones across different customers are blocked. The legacy customers.phone
-- column is kept as a mirror of the primary for zero-regression reads.

CREATE TABLE public.customer_phones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  phone text NOT NULL,
  label text,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.customer_phones TO authenticated;
GRANT ALL ON public.customer_phones TO service_role;

ALTER TABLE public.customer_phones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "customer_phones_select_own" ON public.customer_phones
  FOR SELECT TO authenticated USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'owner'));
CREATE POLICY "customer_phones_insert_own" ON public.customer_phones
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'owner'));
CREATE POLICY "customer_phones_update_own" ON public.customer_phones
  FOR UPDATE TO authenticated USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'owner'));
CREATE POLICY "customer_phones_delete_own" ON public.customer_phones
  FOR DELETE TO authenticated USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'owner'));

-- Cross-customer duplicate phones are not allowed.
CREATE UNIQUE INDEX customer_phones_phone_unique ON public.customer_phones (phone);
-- Exactly one primary per customer.
CREATE UNIQUE INDEX customer_phones_one_primary ON public.customer_phones (customer_id) WHERE is_primary;
CREATE INDEX customer_phones_customer_idx ON public.customer_phones (customer_id);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.tg_customer_phones_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
CREATE TRIGGER customer_phones_touch_updated_at BEFORE UPDATE ON public.customer_phones
  FOR EACH ROW EXECUTE FUNCTION public.tg_customer_phones_touch_updated_at();

-- Keep customers.phone mirrored to the primary phone so every legacy read path
-- (search, WhatsApp, invoice, autocomplete, exports) keeps working with no
-- change. Triggers run for INSERT/UPDATE/DELETE.
CREATE OR REPLACE FUNCTION public.tg_customer_phones_sync_primary()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_customer uuid;
  v_primary text;
BEGIN
  v_customer := COALESCE(NEW.customer_id, OLD.customer_id);
  SELECT phone INTO v_primary FROM public.customer_phones
    WHERE customer_id = v_customer AND is_primary = true LIMIT 1;
  UPDATE public.customers SET phone = v_primary, updated_at = now() WHERE id = v_customer;
  RETURN NEW;
END; $$;
CREATE TRIGGER customer_phones_sync_primary
  AFTER INSERT OR UPDATE OR DELETE ON public.customer_phones
  FOR EACH ROW EXECUTE FUNCTION public.tg_customer_phones_sync_primary();

-- Backfill: every existing customer with a phone gets a primary row in
-- customer_phones. Conflicts on the unique phone index (already-duplicated
-- data pre-migration) are skipped — those will surface as data issues to
-- resolve manually rather than breaking the migration.
INSERT INTO public.customer_phones (customer_id, user_id, phone, is_primary, label)
SELECT id, user_id, phone, true, 'Primary'
FROM public.customers
WHERE phone IS NOT NULL AND trim(phone) <> ''
ON CONFLICT (phone) DO NOTHING;