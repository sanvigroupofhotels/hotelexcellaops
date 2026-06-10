
-- =====================================================
-- 1. ROOM RATES (defaults per room type)
-- =====================================================
CREATE TABLE public.room_rates (
  room_type    text PRIMARY KEY,
  default_rate numeric NOT NULL DEFAULT 0,
  weekday_rate numeric,
  weekend_rate numeric,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   uuid
);
GRANT SELECT ON public.room_rates TO authenticated;
GRANT ALL ON public.room_rates TO service_role;
ALTER TABLE public.room_rates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rates_read_auth" ON public.room_rates FOR SELECT TO authenticated USING (true);
CREATE POLICY "rates_admin_write" ON public.room_rates FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
GRANT INSERT, UPDATE, DELETE ON public.room_rates TO authenticated;

CREATE TRIGGER trg_room_rates_updated BEFORE UPDATE ON public.room_rates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =====================================================
-- 2. RATE OVERRIDES (date-specific)
-- =====================================================
CREATE TABLE public.rate_overrides (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_type  text NOT NULL,
  date       date NOT NULL,
  rate       numeric NOT NULL,
  note       text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (room_type, date)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rate_overrides TO authenticated;
GRANT ALL ON public.rate_overrides TO service_role;
ALTER TABLE public.rate_overrides ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ovr_read_auth" ON public.rate_overrides FOR SELECT TO authenticated USING (true);
CREATE POLICY "ovr_admin_write" ON public.rate_overrides FOR INSERT TO authenticated WITH CHECK (public.is_admin());
CREATE POLICY "ovr_admin_update" ON public.rate_overrides FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "ovr_admin_delete" ON public.rate_overrides FOR DELETE TO authenticated USING (public.is_admin());
CREATE INDEX idx_rate_overrides_room_date ON public.rate_overrides(room_type, date);
CREATE TRIGGER trg_rate_overrides_updated BEFORE UPDATE ON public.rate_overrides
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =====================================================
-- 3. MASTER DATA (lead_source, tag, ...)
-- =====================================================
CREATE TABLE public.master_data (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category   text NOT NULL,
  value      text NOT NULL,
  label      text NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (category, value)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.master_data TO authenticated;
GRANT ALL ON public.master_data TO service_role;
ALTER TABLE public.master_data ENABLE ROW LEVEL SECURITY;
CREATE POLICY "md_read_auth" ON public.master_data FOR SELECT TO authenticated USING (true);
CREATE POLICY "md_admin_insert" ON public.master_data FOR INSERT TO authenticated WITH CHECK (public.is_admin());
CREATE POLICY "md_admin_update" ON public.master_data FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "md_admin_delete" ON public.master_data FOR DELETE TO authenticated USING (public.is_admin());
CREATE TRIGGER trg_master_data_updated BEFORE UPDATE ON public.master_data
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Seed lead sources
INSERT INTO public.master_data(category, value, label, sort_order) VALUES
  ('lead_source','Direct','Direct',10),
  ('lead_source','Walk-In','Walk-In',20),
  ('lead_source','Phone','Phone',30),
  ('lead_source','WhatsApp','WhatsApp',40),
  ('lead_source','Booking.com','Booking.com',50),
  ('lead_source','MMT','MakeMyTrip',60),
  ('lead_source','Treebo','Treebo',70),
  ('lead_source','Hotelzify','Hotelzify',80),
  ('tag','VIP','VIP',10),
  ('tag','Warm Lead','Warm Lead',20),
  ('tag','Corporate','Corporate',30),
  ('tag','Repeat Guest','Repeat Guest',40)
ON CONFLICT (category, value) DO NOTHING;

-- =====================================================
-- 4. ROOM BLOCKING (extend room_maintenance with audit)
-- =====================================================
ALTER TABLE public.room_maintenance
  ADD COLUMN IF NOT EXISTS blocked_by uuid,
  ADD COLUMN IF NOT EXISTS blocked_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS unblocked_by uuid,
  ADD COLUMN IF NOT EXISTS unblocked_at timestamptz,
  ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;

-- Block-vs-booking conflict trigger (admins can override)
CREATE OR REPLACE FUNCTION public.bookings_prevent_block_conflict()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_conflict int;
BEGIN
  IF NEW.room_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.status IN ('Cancelled','Checked-Out','Stay Completed') THEN RETURN NEW; END IF;
  IF public.is_admin() THEN RETURN NEW; END IF;
  SELECT count(*) INTO v_conflict
    FROM public.room_maintenance m
    WHERE m.room_id = NEW.room_id
      AND m.active = true
      AND m.start_date < NEW.check_out
      AND NEW.check_in < m.end_date;
  IF v_conflict > 0 THEN
    RAISE EXCEPTION 'Room is blocked for the selected dates. Unblock the room or ask an admin to override.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_bookings_block_conflict ON public.bookings;
CREATE TRIGGER trg_bookings_block_conflict
  BEFORE INSERT OR UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.bookings_prevent_block_conflict();
