
-- =========================================
-- CRM Phase 1: Leads, Lead Activities, Auto-conversion
-- =========================================

-- 1. lead_status enum
DO $$ BEGIN
  CREATE TYPE public.lead_status AS ENUM ('Interested', 'Abandoned', 'Converted', 'Lost');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. leads table  (ONE row per mobile)
CREATE TABLE IF NOT EXISTS public.leads (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid,
  customer_id       uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  booking_id        uuid REFERENCES public.bookings(id) ON DELETE SET NULL,

  guest_name        text NOT NULL,
  phone             text NOT NULL UNIQUE,
  email             text,
  check_in          date,
  check_out         date,
  adults            int,
  children          int,
  rooms             int,
  room_type_id      uuid,
  room_type_name    text,
  estimated_total   numeric(12,2),

  status            public.lead_status NOT NULL DEFAULT 'Interested',
  source_channel    text NOT NULL DEFAULT 'BookingEngine',
  lost_reason       text,
  notes             text,

  last_activity_at  timestamptz NOT NULL DEFAULT now(),
  abandoned_at      timestamptz,
  converted_at      timestamptz,
  lost_at           timestamptz,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.leads TO authenticated;
GRANT ALL ON public.leads TO service_role;

ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "leads_select_authenticated" ON public.leads;
CREATE POLICY "leads_select_authenticated" ON public.leads FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "leads_modify_authenticated" ON public.leads;
CREATE POLICY "leads_modify_authenticated" ON public.leads FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS leads_status_idx ON public.leads(status);
CREATE INDEX IF NOT EXISTS leads_customer_idx ON public.leads(customer_id);
CREATE INDEX IF NOT EXISTS leads_booking_idx ON public.leads(booking_id);
CREATE INDEX IF NOT EXISTS leads_last_activity_idx ON public.leads(last_activity_at);

-- 3. lead_activities table  (lifetime audit trail)
CREATE TABLE IF NOT EXISTS public.lead_activities (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id       uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  actor_id      uuid,
  actor_name    text,
  actor_role    text,
  action        text NOT NULL,
  field         text,
  old_value     text,
  new_value     text,
  summary       text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.lead_activities TO authenticated;
GRANT ALL ON public.lead_activities TO service_role;

ALTER TABLE public.lead_activities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "lead_act_select" ON public.lead_activities;
CREATE POLICY "lead_act_select" ON public.lead_activities FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "lead_act_insert" ON public.lead_activities;
CREATE POLICY "lead_act_insert" ON public.lead_activities FOR INSERT TO authenticated WITH CHECK (true);

CREATE INDEX IF NOT EXISTS lead_act_lead_idx ON public.lead_activities(lead_id, created_at DESC);

-- 4. bookings.lead_id
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS bookings_lead_idx ON public.bookings(lead_id);

-- 5. customers.first_lead_at, lead_count
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS first_lead_at timestamptz;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS lead_count int NOT NULL DEFAULT 0;

-- 6. Standard updated_at trigger on leads
DROP TRIGGER IF EXISTS leads_set_updated_at ON public.leads;
CREATE TRIGGER leads_set_updated_at BEFORE UPDATE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 7. Link/create customer for a lead (same idea as bookings)
CREATE OR REPLACE FUNCTION public.leads_link_or_create_customer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_customer_id uuid;
  v_phone text := NULLIF(trim(NEW.phone), '');
  v_email text := NULLIF(lower(trim(NEW.email)), '');
BEGIN
  IF NEW.customer_id IS NOT NULL THEN RETURN NEW; END IF;
  IF v_phone IS NOT NULL THEN
    SELECT id INTO v_customer_id FROM public.customers
      WHERE NULLIF(trim(phone),'') = v_phone ORDER BY created_at ASC LIMIT 1;
  END IF;
  IF v_customer_id IS NULL AND v_email IS NOT NULL THEN
    SELECT id INTO v_customer_id FROM public.customers
      WHERE lower(NULLIF(trim(email),'')) = v_email ORDER BY created_at ASC LIMIT 1;
  END IF;
  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (user_id, guest_name, phone, email, lead_source, first_lead_at)
    VALUES (NEW.user_id, NEW.guest_name, NEW.phone, NEW.email, NEW.source_channel, now())
    RETURNING id INTO v_customer_id;
  ELSE
    UPDATE public.customers
      SET first_lead_at = COALESCE(first_lead_at, now())
      WHERE id = v_customer_id;
  END IF;
  NEW.customer_id := v_customer_id;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS leads_link_customer_biu ON public.leads;
CREATE TRIGGER leads_link_customer_biu
  BEFORE INSERT OR UPDATE OF phone, email, customer_id ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.leads_link_or_create_customer();

-- 8. Recompute customers.lead_count after lead insert/delete
CREATE OR REPLACE FUNCTION public.leads_recompute_customer_count()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_cid uuid;
BEGIN
  v_cid := COALESCE(NEW.customer_id, OLD.customer_id);
  IF v_cid IS NULL THEN RETURN NULL; END IF;
  UPDATE public.customers c
    SET lead_count = (SELECT count(*)::int FROM public.leads WHERE customer_id = v_cid)
    WHERE c.id = v_cid;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS leads_recompute_count_aiu ON public.leads;
CREATE TRIGGER leads_recompute_count_aiu
  AFTER INSERT OR UPDATE OF customer_id OR DELETE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.leads_recompute_customer_count();

-- 9. Lead activity audit trigger
CREATE OR REPLACE FUNCTION public.leads_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE a record;
BEGIN
  SELECT * INTO a FROM public.current_actor();
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.lead_activities(lead_id, actor_id, actor_name, actor_role, action, summary)
      VALUES (NEW.id, a.uid, a.display_name, a.role, 'created',
        CONCAT('Lead created · ', NEW.guest_name, ' · ', NEW.phone, ' · ', NEW.status::text));
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.status IS DISTINCT FROM NEW.status THEN
      INSERT INTO public.lead_activities(lead_id, actor_id, actor_name, actor_role, action, field, old_value, new_value, summary)
        VALUES (NEW.id, a.uid, a.display_name, a.role,
          CASE NEW.status::text
            WHEN 'Converted' THEN 'converted'
            WHEN 'Lost' THEN 'lost'
            WHEN 'Interested' THEN CASE WHEN OLD.status::text IN ('Lost','Abandoned') THEN 'reopened' ELSE 'status_changed' END
            ELSE 'status_changed' END,
          'Status', OLD.status::text, NEW.status::text,
          CONCAT('Status: ', OLD.status::text, ' → ', NEW.status::text));
    END IF;
    IF OLD.guest_name IS DISTINCT FROM NEW.guest_name THEN
      INSERT INTO public.lead_activities(lead_id, actor_id, actor_name, actor_role, action, field, old_value, new_value, summary)
        VALUES (NEW.id, a.uid, a.display_name, a.role, 'updated', 'Name', OLD.guest_name, NEW.guest_name, 'Guest name changed');
    END IF;
    IF COALESCE(OLD.check_in::text,'') IS DISTINCT FROM COALESCE(NEW.check_in::text,'')
       OR COALESCE(OLD.check_out::text,'') IS DISTINCT FROM COALESCE(NEW.check_out::text,'') THEN
      INSERT INTO public.lead_activities(lead_id, actor_id, actor_name, actor_role, action, summary)
        VALUES (NEW.id, a.uid, a.display_name, a.role, 'updated',
          CONCAT('Dates: ', COALESCE(OLD.check_in::text,'—'),' → ',COALESCE(OLD.check_out::text,'—'),
                 '  ⇒  ',COALESCE(NEW.check_in::text,'—'),' → ',COALESCE(NEW.check_out::text,'—')));
    END IF;
    IF OLD.estimated_total IS DISTINCT FROM NEW.estimated_total THEN
      INSERT INTO public.lead_activities(lead_id, actor_id, actor_name, actor_role, action, field, old_value, new_value, summary)
        VALUES (NEW.id, a.uid, a.display_name, a.role, 'updated', 'Estimated Total',
          OLD.estimated_total::text, NEW.estimated_total::text, 'Estimated total updated');
    END IF;
    RETURN NEW;
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS leads_audit_aiu ON public.leads;
CREATE TRIGGER leads_audit_aiu AFTER INSERT OR UPDATE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.leads_audit();

-- 10. Auto-convert lead when a booking is created/updated with the same phone
CREATE OR REPLACE FUNCTION public.bookings_auto_convert_lead()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lead_id uuid;
  v_phone text := NULLIF(trim(NEW.phone), '');
BEGIN
  -- Draft bookings shouldn't convert; only real bookings.
  IF NEW.status::text = 'Draft' THEN RETURN NEW; END IF;
  IF v_phone IS NULL THEN RETURN NEW; END IF;
  IF NEW.lead_id IS NOT NULL THEN
    UPDATE public.leads
       SET status = 'Converted',
           converted_at = COALESCE(converted_at, now()),
           booking_id = NEW.id,
           customer_id = COALESCE(customer_id, NEW.customer_id),
           last_activity_at = now()
     WHERE id = NEW.lead_id
       AND status <> 'Converted';
    RETURN NEW;
  END IF;
  SELECT id INTO v_lead_id FROM public.leads
    WHERE phone = v_phone AND status IN ('Interested','Abandoned')
    ORDER BY created_at DESC LIMIT 1;
  IF v_lead_id IS NULL THEN RETURN NEW; END IF;
  UPDATE public.leads
    SET status = 'Converted',
        converted_at = now(),
        booking_id = NEW.id,
        customer_id = COALESCE(customer_id, NEW.customer_id),
        last_activity_at = now()
    WHERE id = v_lead_id;
  NEW.lead_id := v_lead_id;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS bookings_auto_convert_lead_biu ON public.bookings;
CREATE TRIGGER bookings_auto_convert_lead_biu
  BEFORE INSERT OR UPDATE OF phone, status ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.bookings_auto_convert_lead();

-- 11. Sweep: Interested → Abandoned
CREATE OR REPLACE FUNCTION public.sweep_abandoned_leads()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_minutes int;
  n int;
BEGIN
  SELECT COALESCE( ((value->>'abandon_minutes'))::int, 10) INTO v_minutes
    FROM public.app_settings WHERE key = 'crm';
  IF v_minutes IS NULL OR v_minutes <= 0 THEN v_minutes := 10; END IF;

  WITH upd AS (
    UPDATE public.leads
       SET status = 'Abandoned', abandoned_at = now()
     WHERE status = 'Interested'
       AND booking_id IS NULL
       AND last_activity_at < (now() - make_interval(mins => v_minutes))
     RETURNING 1
  ) SELECT count(*) INTO n FROM upd;
  RETURN COALESCE(n, 0);
END $$;

-- 12. Sweep: Interested/Abandoned past check_out with no booking → Lost
CREATE OR REPLACE FUNCTION public.sweep_lost_leads()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE n int;
BEGIN
  WITH upd AS (
    UPDATE public.leads
       SET status = 'Lost',
           lost_at = now(),
           lost_reason = COALESCE(lost_reason, 'Auto: past check-out with no booking')
     WHERE status IN ('Interested','Abandoned')
       AND booking_id IS NULL
       AND check_out IS NOT NULL
       AND check_out < current_date
     RETURNING 1
  ) SELECT count(*) INTO n FROM upd;
  RETURN COALESCE(n, 0);
END $$;

-- 13. Seed default CRM settings if not present
INSERT INTO public.app_settings (key, value)
SELECT 'crm', jsonb_build_object(
  'abandon_minutes', 10,
  'notify_reception_emails', jsonb_build_array('hotelexcellaoperations@gmail.com'),
  'notify_owner_phones', '[]'::jsonb,
  'notify_on_lead', true,
  'notify_on_abandon', true,
  'notify_on_lost', false
)
WHERE NOT EXISTS (SELECT 1 FROM public.app_settings WHERE key = 'crm');
