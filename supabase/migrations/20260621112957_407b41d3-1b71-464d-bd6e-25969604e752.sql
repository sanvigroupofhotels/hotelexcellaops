
-- ============ night_audit_sessions ============
CREATE TABLE IF NOT EXISTS public.night_audit_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_date date NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','reopened')),
  opened_at timestamptz NOT NULL DEFAULT now(),
  opened_by_id uuid,
  opened_by_name text,
  closed_at timestamptz,
  closed_by_id uuid,
  closed_by_name text,
  reopen_reason text,
  totals jsonb NOT NULL DEFAULT '{}'::jsonb,
  eod_html text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Only one open session per business_date
CREATE UNIQUE INDEX IF NOT EXISTS night_audit_sessions_one_open_per_date
  ON public.night_audit_sessions(business_date)
  WHERE status = 'open';

CREATE INDEX IF NOT EXISTS night_audit_sessions_bd_idx
  ON public.night_audit_sessions(business_date DESC);

GRANT SELECT, INSERT, UPDATE ON public.night_audit_sessions TO authenticated;
GRANT ALL ON public.night_audit_sessions TO service_role;

ALTER TABLE public.night_audit_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "NA sessions: authenticated read"
  ON public.night_audit_sessions FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "NA sessions: admin/owner insert"
  ON public.night_audit_sessions FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'owner'));

CREATE POLICY "NA sessions: admin/owner update"
  ON public.night_audit_sessions FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'owner'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'owner'));

CREATE TRIGGER night_audit_sessions_set_updated_at
  BEFORE UPDATE ON public.night_audit_sessions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ night_audit_decisions ============
CREATE TABLE IF NOT EXISTS public.night_audit_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.night_audit_sessions(id) ON DELETE CASCADE,
  business_date date NOT NULL,
  step text NOT NULL,
  action text NOT NULL,
  booking_id uuid,
  before_status text,
  after_status text,
  reason text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_id uuid,
  actor_name text,
  actor_role text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS night_audit_decisions_session_idx
  ON public.night_audit_decisions(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS night_audit_decisions_booking_idx
  ON public.night_audit_decisions(booking_id);

GRANT SELECT, INSERT ON public.night_audit_decisions TO authenticated;
GRANT ALL ON public.night_audit_decisions TO service_role;

ALTER TABLE public.night_audit_decisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "NA decisions: authenticated read"
  ON public.night_audit_decisions FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "NA decisions: authenticated append"
  ON public.night_audit_decisions FOR INSERT
  TO authenticated WITH CHECK (true);

-- ============ bookings ↔ customer phone invariant trigger ============
CREATE OR REPLACE FUNCTION public.bookings_ensure_customer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_phone text := public.normalize_phone_in(NEW.phone);
  v_cust_phone text;
  v_customer_id uuid;
BEGIN
  IF v_phone IS NULL THEN RETURN NEW; END IF;
  -- Canonicalize booking.phone so storage matches lookup key
  NEW.phone := v_phone;

  IF NEW.customer_id IS NOT NULL THEN
    SELECT public.normalize_phone_in(phone) INTO v_cust_phone
      FROM public.customers WHERE id = NEW.customer_id;
    IF v_cust_phone IS NOT DISTINCT FROM v_phone THEN
      RETURN NEW; -- already consistent
    END IF;
  END IF;

  -- Find an existing customer by canonical phone
  SELECT id INTO v_customer_id
    FROM public.customers
    WHERE public.normalize_phone_in(phone) = v_phone
    ORDER BY created_at ASC
    LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (user_id, guest_name, phone, email, lead_source, first_lead_at)
    VALUES (NEW.user_id, NEW.guest_name, v_phone, NEW.email,
            COALESCE(NEW.source_channel, 'Direct'), now())
    RETURNING id INTO v_customer_id;
  END IF;

  NEW.customer_id := v_customer_id;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_bookings_ensure_customer ON public.bookings;
CREATE TRIGGER trg_bookings_ensure_customer
  BEFORE INSERT OR UPDATE OF phone, customer_id ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.bookings_ensure_customer();
