
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS source_channel text NOT NULL DEFAULT 'PMS',
  ADD COLUMN IF NOT EXISTS pay_at_hotel boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS gateway_order_id text,
  ADD COLUMN IF NOT EXISTS gateway_payment_id text,
  ADD COLUMN IF NOT EXISTS draft_expires_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_bookings_source_channel ON public.bookings(source_channel);
CREATE INDEX IF NOT EXISTS idx_bookings_draft_expires ON public.bookings(draft_expires_at);
CREATE INDEX IF NOT EXISTS idx_bookings_gateway_payment_id ON public.bookings(gateway_payment_id);

CREATE TABLE IF NOT EXISTS public.promo_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  description text,
  discount_type text NOT NULL CHECK (discount_type IN ('percent','fixed')),
  discount_value numeric NOT NULL CHECK (discount_value >= 0),
  valid_from date,
  valid_to date,
  min_nights int DEFAULT 1,
  applicable_room_types text[],
  max_uses int,
  used_count int NOT NULL DEFAULT 0,
  applies_to text NOT NULL DEFAULT 'all' CHECK (applies_to IN ('all','weekend','weekday','season','corporate')),
  season_label text,
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.promo_codes TO authenticated;
GRANT ALL ON public.promo_codes TO service_role;

ALTER TABLE public.promo_codes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage promo codes" ON public.promo_codes;
CREATE POLICY "Admins manage promo codes" ON public.promo_codes
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Authenticated read promo codes" ON public.promo_codes;
CREATE POLICY "Authenticated read promo codes" ON public.promo_codes
  FOR SELECT TO authenticated USING (true);

DROP TRIGGER IF EXISTS trg_promo_codes_updated_at ON public.promo_codes;
CREATE TRIGGER trg_promo_codes_updated_at
  BEFORE UPDATE ON public.promo_codes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.guest_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  rating int NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment text,
  would_recommend boolean,
  guest_name text,
  is_public boolean NOT NULL DEFAULT false,
  moderated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.guest_reviews TO authenticated;
GRANT ALL ON public.guest_reviews TO service_role;

ALTER TABLE public.guest_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read reviews" ON public.guest_reviews;
CREATE POLICY "Authenticated read reviews" ON public.guest_reviews
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Admins manage reviews" ON public.guest_reviews;
CREATE POLICY "Admins manage reviews" ON public.guest_reviews
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP TRIGGER IF EXISTS trg_guest_reviews_updated_at ON public.guest_reviews;
CREATE TRIGGER trg_guest_reviews_updated_at
  BEFORE UPDATE ON public.guest_reviews
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP POLICY IF EXISTS "Public read active rooms" ON public.rooms;
CREATE POLICY "Public read active rooms" ON public.rooms
  FOR SELECT TO anon USING (active = true);
GRANT SELECT ON public.rooms TO anon;

DROP POLICY IF EXISTS "Public read room rates" ON public.room_rates;
CREATE POLICY "Public read room rates" ON public.room_rates
  FOR SELECT TO anon USING (true);
GRANT SELECT ON public.room_rates TO anon;

DROP POLICY IF EXISTS "Public read rate overrides" ON public.rate_overrides;
CREATE POLICY "Public read rate overrides" ON public.rate_overrides
  FOR SELECT TO anon USING (true);
GRANT SELECT ON public.rate_overrides TO anon;

DROP POLICY IF EXISTS "Public read app settings" ON public.app_settings;
CREATE POLICY "Public read app settings" ON public.app_settings
  FOR SELECT TO anon USING (true);
GRANT SELECT ON public.app_settings TO anon;

CREATE OR REPLACE FUNCTION public.sweep_expired_draft_bookings()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE n int;
BEGIN
  WITH del AS (
    DELETE FROM public.bookings
    WHERE status::text = 'Draft'
      AND source_channel = 'BookingEngine'
      AND draft_expires_at IS NOT NULL
      AND draft_expires_at < now()
    RETURNING 1
  ) SELECT count(*) INTO n FROM del;
  RETURN COALESCE(n, 0);
END $$;
