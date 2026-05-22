
-- ============ CUSTOMERS ============
CREATE TABLE IF NOT EXISTS public.customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  customer_reference text NOT NULL UNIQUE DEFAULT ('CX-' || upper(substring(md5(random()::text), 1, 6))),
  guest_name text NOT NULL,
  phone text,
  email text,
  city text,
  state text,
  country text DEFAULT 'India',
  birthday date,
  anniversary date,
  guest_type text DEFAULT 'Individual',
  company_name text,
  gst_number text,
  preferred_room text,
  preferred_food text,
  special_notes text,
  lead_source text DEFAULT 'Direct',
  first_contact_date timestamptz NOT NULL DEFAULT now(),
  last_stay_date date,
  total_quotes integer NOT NULL DEFAULT 0,
  total_bookings integer NOT NULL DEFAULT 0,
  total_revenue numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'Warm Lead',
  tags text[] NOT NULL DEFAULT '{}',
  booking_probability integer NOT NULL DEFAULT 50,
  next_action text,
  next_followup_date date,
  payment_status text DEFAULT 'None',
  lost_reason text,
  internal_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS customers_phone_idx ON public.customers (phone);
CREATE INDEX IF NOT EXISTS customers_email_idx ON public.customers (lower(email));
CREATE INDEX IF NOT EXISTS customers_status_idx ON public.customers (status);

ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

CREATE POLICY customers_select_auth ON public.customers FOR SELECT TO authenticated USING (true);
CREATE POLICY customers_insert_own ON public.customers FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY customers_update_own ON public.customers FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY customers_delete_own ON public.customers FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER customers_set_updated_at
BEFORE UPDATE ON public.customers
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ QUOTES additions ============
ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS adults integer NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS guests integer NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS pet_size text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'None',
  ADD COLUMN IF NOT EXISTS booking_probability integer NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS lost_reason text;

ALTER TABLE public.quotes DROP CONSTRAINT IF EXISTS quotes_pet_size_chk;
ALTER TABLE public.quotes ADD CONSTRAINT quotes_pet_size_chk
  CHECK (pet_size IN ('none','small','medium','large'));

CREATE INDEX IF NOT EXISTS quotes_customer_id_idx ON public.quotes (customer_id);

-- ============ TASKS ============
CREATE TABLE IF NOT EXISTS public.tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  title text NOT NULL,
  type text NOT NULL DEFAULT 'Follow-up',
  priority text NOT NULL DEFAULT 'Medium',
  due_date date,
  status text NOT NULL DEFAULT 'Open',
  notes text,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  quote_id uuid REFERENCES public.quotes(id) ON DELETE SET NULL,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tasks_due_date_idx ON public.tasks (due_date);
CREATE INDEX IF NOT EXISTS tasks_status_idx ON public.tasks (status);

ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY tasks_select_auth ON public.tasks FOR SELECT TO authenticated USING (true);
CREATE POLICY tasks_insert_own ON public.tasks FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY tasks_update_own ON public.tasks FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY tasks_delete_own ON public.tasks FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER tasks_set_updated_at
BEFORE UPDATE ON public.tasks
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ AUTO-LINK customer on quote insert ============
CREATE OR REPLACE FUNCTION public.link_or_create_customer()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_customer_id uuid;
BEGIN
  IF NEW.customer_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- match by phone first, then email
  SELECT id INTO v_customer_id
  FROM public.customers
  WHERE (NEW.phone IS NOT NULL AND phone = NEW.phone)
     OR (NEW.email IS NOT NULL AND lower(email) = lower(NEW.email))
  ORDER BY created_at ASC
  LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (user_id, guest_name, phone, email, lead_source)
    VALUES (NEW.user_id, NEW.guest_name, NEW.phone, NEW.email, COALESCE(NEW.lead_source, 'Direct'))
    RETURNING id INTO v_customer_id;
  END IF;

  NEW.customer_id := v_customer_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS quotes_link_customer ON public.quotes;
CREATE TRIGGER quotes_link_customer
BEFORE INSERT ON public.quotes
FOR EACH ROW EXECUTE FUNCTION public.link_or_create_customer();

-- ============ Bump customer counters ============
CREATE OR REPLACE FUNCTION public.recompute_customer_stats(p_customer_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_customer_id IS NULL THEN RETURN; END IF;
  UPDATE public.customers c
  SET total_quotes = sub.total_quotes,
      total_bookings = sub.total_bookings,
      total_revenue = sub.total_revenue,
      last_stay_date = sub.last_stay_date
  FROM (
    SELECT
      COUNT(*)::int AS total_quotes,
      COUNT(*) FILTER (WHERE status IN ('Confirmed','Booked','Completed'))::int AS total_bookings,
      COALESCE(SUM(total) FILTER (WHERE status IN ('Confirmed','Booked','Completed')), 0) AS total_revenue,
      MAX(check_out) FILTER (WHERE status IN ('Confirmed','Booked','Completed')) AS last_stay_date
    FROM public.quotes WHERE customer_id = p_customer_id
  ) sub
  WHERE c.id = p_customer_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.quotes_after_change_update_customer()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.recompute_customer_stats(COALESCE(NEW.customer_id, OLD.customer_id));
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS quotes_aiud_customer_stats ON public.quotes;
CREATE TRIGGER quotes_aiud_customer_stats
AFTER INSERT OR UPDATE OR DELETE ON public.quotes
FOR EACH ROW EXECUTE FUNCTION public.quotes_after_change_update_customer();

-- ============ Realtime ============
ALTER TABLE public.customers REPLICA IDENTITY FULL;
ALTER TABLE public.tasks REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.customers;
ALTER PUBLICATION supabase_realtime ADD TABLE public.tasks;
