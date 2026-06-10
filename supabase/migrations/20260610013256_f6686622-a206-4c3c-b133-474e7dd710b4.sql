
-- 1. Pricing breakdown columns on bookings (mirror quotes)
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS subtotal numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS taxes numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_rate numeric NOT NULL DEFAULT 0.05;

-- Preserve existing booking totals: tag historic rows as tax-exclusive (rate 0)
UPDATE public.bookings
  SET subtotal = COALESCE(amount, 0), taxes = 0, tax_rate = 0
  WHERE subtotal = 0 AND taxes = 0;

-- 2. Check-Out override / Revert audit fields
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS checkout_override_at timestamptz,
  ADD COLUMN IF NOT EXISTS checkout_override_by uuid,
  ADD COLUMN IF NOT EXISTS checkout_override_balance numeric,
  ADD COLUMN IF NOT EXISTS checkout_override_reason text;

-- 3. Booking status / lifecycle audit table (for check-in/out, revert, override)
CREATE TABLE IF NOT EXISTS public.booking_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  actor_id uuid,
  actor_name text,
  actor_role text,
  action text NOT NULL, -- check_in, check_out, revert_check_in, revert_check_out, checkout_override, cancelled, reactivated
  from_status text,
  to_status text,
  notes text,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.booking_activities TO authenticated;
GRANT ALL ON public.booking_activities TO service_role;
ALTER TABLE public.booking_activities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ba_select ON public.booking_activities;
CREATE POLICY ba_select ON public.booking_activities FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS ba_insert ON public.booking_activities;
CREATE POLICY ba_insert ON public.booking_activities FOR INSERT TO authenticated WITH CHECK (true);

CREATE INDEX IF NOT EXISTS booking_activities_booking_id_idx
  ON public.booking_activities(booking_id, created_at DESC);
