
-- Staff master
CREATE TABLE public.staff (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  mobile text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff TO authenticated;
GRANT ALL ON public.staff TO service_role;
ALTER TABLE public.staff ENABLE ROW LEVEL SECURITY;
CREATE POLICY staff_select_all ON public.staff FOR SELECT TO authenticated USING (true);
CREATE POLICY staff_insert_admin ON public.staff FOR INSERT TO authenticated WITH CHECK (is_admin() AND auth.uid() = user_id);
CREATE POLICY staff_update_admin ON public.staff FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY staff_delete_admin ON public.staff FOR DELETE TO authenticated USING (is_admin());
CREATE TRIGGER staff_set_updated_at BEFORE UPDATE ON public.staff FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Expense types master
CREATE TABLE public.expense_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.expense_types TO authenticated;
GRANT ALL ON public.expense_types TO service_role;
ALTER TABLE public.expense_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY etypes_select_all ON public.expense_types FOR SELECT TO authenticated USING (true);
CREATE POLICY etypes_insert_admin ON public.expense_types FOR INSERT TO authenticated WITH CHECK (is_admin() AND auth.uid() = user_id);
CREATE POLICY etypes_update_admin ON public.expense_types FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY etypes_delete_admin ON public.expense_types FOR DELETE TO authenticated USING (is_admin());
CREATE TRIGGER etypes_set_updated_at BEFORE UPDATE ON public.expense_types FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Cash transactions (unified)
CREATE TABLE public.cash_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('collection','expense')),
  type_name text NOT NULL,
  description text,
  guest_name text,
  guest_mobile text,
  room_number text,
  booking_id uuid,
  customer_id uuid,
  staff_id uuid,
  staff_name text,
  amount numeric NOT NULL CHECK (amount >= 0),
  notes text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  active boolean NOT NULL DEFAULT true,
  modified_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cash_transactions TO authenticated;
GRANT ALL ON public.cash_transactions TO service_role;
ALTER TABLE public.cash_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY cashtx_select_all ON public.cash_transactions FOR SELECT TO authenticated USING (true);
CREATE POLICY cashtx_insert_auth ON public.cash_transactions FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY cashtx_update_auth ON public.cash_transactions FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY cashtx_delete_admin ON public.cash_transactions FOR DELETE TO authenticated USING (is_admin());
CREATE TRIGGER cashtx_set_updated_at BEFORE UPDATE ON public.cash_transactions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX cashtx_occurred_idx ON public.cash_transactions (occurred_at DESC);
CREATE INDEX cashtx_kind_idx ON public.cash_transactions (kind);

-- Link or create customer for collections by mobile
CREATE OR REPLACE FUNCTION public.cashtx_link_customer()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_customer_id uuid;
BEGIN
  IF NEW.kind <> 'collection' THEN RETURN NEW; END IF;
  IF NEW.customer_id IS NOT NULL THEN RETURN NEW; END IF;
  IF NEW.guest_mobile IS NULL OR length(trim(NEW.guest_mobile)) = 0 THEN RETURN NEW; END IF;
  SELECT id INTO v_customer_id FROM public.customers WHERE phone = NEW.guest_mobile ORDER BY created_at ASC LIMIT 1;
  IF v_customer_id IS NULL AND NEW.guest_name IS NOT NULL THEN
    INSERT INTO public.customers (user_id, guest_name, phone, lead_source)
    VALUES (NEW.user_id, NEW.guest_name, NEW.guest_mobile, 'Direct')
    RETURNING id INTO v_customer_id;
  END IF;
  NEW.customer_id := v_customer_id;
  RETURN NEW;
END $$;
CREATE TRIGGER cashtx_link_customer_trg BEFORE INSERT ON public.cash_transactions
  FOR EACH ROW EXECUTE FUNCTION public.cashtx_link_customer();

-- Seed defaults using the first available user
DO $$
DECLARE seed_user uuid;
BEGIN
  SELECT id INTO seed_user FROM auth.users ORDER BY created_at ASC LIMIT 1;
  IF seed_user IS NOT NULL THEN
    INSERT INTO public.staff (user_id, name) VALUES
      (seed_user, 'Ravi'), (seed_user, 'Pavani'), (seed_user, 'Lakshmi'), (seed_user, 'Shiva')
      ON CONFLICT DO NOTHING;
    INSERT INTO public.expense_types (user_id, name) VALUES
      (seed_user, 'Handed over to Owner'),
      (seed_user, 'Paid to Tiffens Shiva'),
      (seed_user, 'Paid to HK Pavani'),
      (seed_user, 'Paid to HK Lakshmi'),
      (seed_user, 'Returned to Guest'),
      (seed_user, 'Others')
      ON CONFLICT DO NOTHING;
  END IF;
END $$;
