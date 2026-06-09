
-- 1) Add lead_source to bookings
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS lead_source text DEFAULT 'Direct';

-- Backfill: existing bookings created in-app keep 'Direct' (no historical channel data).
UPDATE public.bookings SET lead_source = 'Direct' WHERE lead_source IS NULL;

-- 2) Rewrite link_or_create_customer trigger:
--    - Reads NEW.lead_source from both quotes and bookings now (both have the column).
--    - Customer inherits source ONLY when a new customer is created; existing
--      customer rows are never overwritten (lead_source on the customer is not touched).
CREATE OR REPLACE FUNCTION public.link_or_create_customer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_customer_id uuid;
  v_phone text := NULLIF(trim(NEW.phone), '');
  v_email text := NULLIF(lower(trim(NEW.email)), '');
  v_lead_source text;
BEGIN
  IF NEW.customer_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Read lead_source from the row when it exists; otherwise default Direct.
  BEGIN
    v_lead_source := COALESCE(NULLIF(trim(row_to_json(NEW)->>'lead_source'), ''), 'Direct');
  EXCEPTION WHEN OTHERS THEN
    v_lead_source := 'Direct';
  END;

  IF v_phone IS NOT NULL THEN
    SELECT id INTO v_customer_id
    FROM public.customers
    WHERE NULLIF(trim(phone),'') = v_phone
    ORDER BY created_at ASC
    LIMIT 1;
  END IF;

  IF v_customer_id IS NULL AND v_email IS NOT NULL THEN
    SELECT id INTO v_customer_id
    FROM public.customers
    WHERE lower(NULLIF(trim(email),'')) = v_email
    ORDER BY created_at ASC
    LIMIT 1;
  END IF;

  IF v_customer_id IS NULL THEN
    -- New customer inherits booking/quote lead_source
    INSERT INTO public.customers (user_id, guest_name, phone, email, lead_source)
    VALUES (NEW.user_id, NEW.guest_name, NEW.phone, NEW.email, v_lead_source)
    RETURNING id INTO v_customer_id;
  END IF;
  -- NOTE: when customer already exists we DO NOT overwrite customers.lead_source.

  NEW.customer_id := v_customer_id;
  RETURN NEW;
END;
$function$;

-- Ensure trigger is bound on bookings (it was already; this is idempotent)
DROP TRIGGER IF EXISTS bookings_link_customer ON public.bookings;
CREATE TRIGGER bookings_link_customer
  BEFORE INSERT ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.link_or_create_customer();

DROP TRIGGER IF EXISTS quotes_link_customer ON public.quotes;
CREATE TRIGGER quotes_link_customer
  BEFORE INSERT ON public.quotes
  FOR EACH ROW EXECUTE FUNCTION public.link_or_create_customer();

-- 3) P12 foundation: per-booking payment rules (no UI yet — safe defaults)
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS allow_full_payment boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS allow_part_payment boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS allow_pay_at_hotel boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS part_payment_type text NOT NULL DEFAULT 'percent',
  ADD COLUMN IF NOT EXISTS part_payment_value numeric NOT NULL DEFAULT 25;

-- Validate part_payment_type values via trigger (avoid CHECK on mutable enum-like text)
CREATE OR REPLACE FUNCTION public.bookings_validate_payment_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.part_payment_type NOT IN ('percent', 'fixed', 'none') THEN
    RAISE EXCEPTION 'part_payment_type must be percent, fixed, or none';
  END IF;
  IF NEW.part_payment_value < 0 THEN
    RAISE EXCEPTION 'part_payment_value cannot be negative';
  END IF;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS bookings_validate_pay_rules ON public.bookings;
CREATE TRIGGER bookings_validate_pay_rules
  BEFORE INSERT OR UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.bookings_validate_payment_rules();

-- 4) P12 foundation: booking_tokens (secure public links for future guest portal)
CREATE TABLE IF NOT EXISTS public.booking_tokens (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  scope text NOT NULL DEFAULT 'view',
  expires_at timestamptz,
  revoked_at timestamptz,
  last_accessed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS booking_tokens_booking_idx ON public.booking_tokens(booking_id);
CREATE INDEX IF NOT EXISTS booking_tokens_token_idx ON public.booking_tokens(token);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.booking_tokens TO authenticated;
GRANT ALL ON public.booking_tokens TO service_role;

ALTER TABLE public.booking_tokens ENABLE ROW LEVEL SECURITY;

-- Staff/owner/admin can view all tokens (so management UI later can list them)
DROP POLICY IF EXISTS booking_tokens_select_auth ON public.booking_tokens;
CREATE POLICY booking_tokens_select_auth ON public.booking_tokens
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS booking_tokens_insert_auth ON public.booking_tokens;
CREATE POLICY booking_tokens_insert_auth ON public.booking_tokens
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS booking_tokens_update_admin ON public.booking_tokens;
CREATE POLICY booking_tokens_update_admin ON public.booking_tokens
  FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());

DROP POLICY IF EXISTS booking_tokens_delete_admin ON public.booking_tokens;
CREATE POLICY booking_tokens_delete_admin ON public.booking_tokens
  FOR DELETE TO authenticated USING (is_admin());

DROP TRIGGER IF EXISTS booking_tokens_set_updated_at ON public.booking_tokens;
CREATE TRIGGER booking_tokens_set_updated_at
  BEFORE UPDATE ON public.booking_tokens
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
