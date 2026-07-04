
-- Sprint A: Razorpay Payment Gateway Modernization
-- Add structured Razorpay columns + unique indexes for idempotency
-- Create razorpay_orders (reuse + reconciliation) and razorpay_webhook_events (idempotent processing)

-- 1) Structured Razorpay columns on booking_payments
ALTER TABLE public.booking_payments
  ADD COLUMN IF NOT EXISTS razorpay_order_id text,
  ADD COLUMN IF NOT EXISTS razorpay_payment_id text,
  ADD COLUMN IF NOT EXISTS razorpay_signature text,
  ADD COLUMN IF NOT EXISTS razorpay_method text;

-- Hard idempotency: at most one booking_payments row per razorpay_payment_id
CREATE UNIQUE INDEX IF NOT EXISTS booking_payments_razorpay_payment_id_uk
  ON public.booking_payments (razorpay_payment_id)
  WHERE razorpay_payment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS booking_payments_razorpay_order_id_idx
  ON public.booking_payments (razorpay_order_id)
  WHERE razorpay_order_id IS NOT NULL;

-- 2) razorpay_orders — tracks every Razorpay order we create so we can reuse
--    an open order for the same booking/intent/amount and reconcile later.
CREATE TABLE IF NOT EXISTS public.razorpay_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  token text NOT NULL,
  intent text NOT NULL CHECK (intent IN ('full','part')),
  order_id text NOT NULL UNIQUE,
  amount_paise bigint NOT NULL CHECK (amount_paise > 0),
  currency text NOT NULL DEFAULT 'INR',
  status text NOT NULL DEFAULT 'created'
    CHECK (status IN ('created','attempted','paid','failed','expired')),
  receipt text,
  notes jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  captured_at timestamptz
);

GRANT SELECT ON public.razorpay_orders TO authenticated;
GRANT ALL ON public.razorpay_orders TO service_role;

ALTER TABLE public.razorpay_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "razorpay_orders_read_auth"
  ON public.razorpay_orders FOR SELECT
  TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS razorpay_orders_booking_idx
  ON public.razorpay_orders (booking_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS razorpay_orders_token_idx
  ON public.razorpay_orders (token);

CREATE OR REPLACE FUNCTION public.razorpay_orders_touch()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS razorpay_orders_touch_trg ON public.razorpay_orders;
CREATE TRIGGER razorpay_orders_touch_trg
  BEFORE UPDATE ON public.razorpay_orders
  FOR EACH ROW EXECUTE FUNCTION public.razorpay_orders_touch();

-- 3) razorpay_webhook_events — idempotent record of every verified webhook
--    delivery. Unique on event_id blocks Razorpay's retries from double-processing.
CREATE TABLE IF NOT EXISTS public.razorpay_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id text NOT NULL UNIQUE,
  event_type text NOT NULL,
  razorpay_order_id text,
  razorpay_payment_id text,
  payload jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  processing_error text
);

GRANT SELECT ON public.razorpay_webhook_events TO authenticated;
GRANT ALL ON public.razorpay_webhook_events TO service_role;

ALTER TABLE public.razorpay_webhook_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "razorpay_webhook_events_read_auth"
  ON public.razorpay_webhook_events FOR SELECT
  TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS razorpay_webhook_events_payment_idx
  ON public.razorpay_webhook_events (razorpay_payment_id)
  WHERE razorpay_payment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS razorpay_webhook_events_order_idx
  ON public.razorpay_webhook_events (razorpay_order_id)
  WHERE razorpay_order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS razorpay_webhook_events_received_idx
  ON public.razorpay_webhook_events (received_at DESC);
