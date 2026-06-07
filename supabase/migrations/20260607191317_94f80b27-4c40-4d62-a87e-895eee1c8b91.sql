
-- Rooms master
CREATE TABLE public.rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  room_number text NOT NULL UNIQUE,
  floor int NOT NULL,
  room_type text NOT NULL DEFAULT 'Oak',
  active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rooms TO authenticated;
GRANT ALL ON public.rooms TO service_role;
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;
CREATE POLICY rooms_select_all ON public.rooms FOR SELECT TO authenticated USING (true);
CREATE POLICY rooms_insert_admin ON public.rooms FOR INSERT TO authenticated WITH CHECK (is_admin() AND auth.uid() = user_id);
CREATE POLICY rooms_update_admin ON public.rooms FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY rooms_delete_admin ON public.rooms FOR DELETE TO authenticated USING (is_admin());
CREATE TRIGGER rooms_set_updated_at BEFORE UPDATE ON public.rooms FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Maintenance blocks (room out of service for a date range)
CREATE TABLE public.room_maintenance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  room_id uuid NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  start_date date NOT NULL,
  end_date date NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.room_maintenance TO authenticated;
GRANT ALL ON public.room_maintenance TO service_role;
ALTER TABLE public.room_maintenance ENABLE ROW LEVEL SECURITY;
CREATE POLICY rmaint_select_all ON public.room_maintenance FOR SELECT TO authenticated USING (true);
CREATE POLICY rmaint_insert_auth ON public.room_maintenance FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY rmaint_update_auth ON public.room_maintenance FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY rmaint_delete_admin ON public.room_maintenance FOR DELETE TO authenticated USING (is_admin() OR auth.uid() = user_id);
CREATE TRIGGER rmaint_set_updated_at BEFORE UPDATE ON public.room_maintenance FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Add room_id to bookings (optional assignment)
ALTER TABLE public.bookings ADD COLUMN room_id uuid REFERENCES public.rooms(id) ON DELETE SET NULL;
CREATE INDEX bookings_room_id_idx ON public.bookings(room_id);

-- Seed initial inventory: floors 1-4, rooms x01-x05 Oak, x06 Mapple, owned by first admin user
DO $$
DECLARE v_uid uuid;
DECLARE f int;
DECLARE r int;
DECLARE rn text;
DECLARE rt text;
BEGIN
  SELECT user_id INTO v_uid FROM public.user_roles WHERE role = 'admin' ORDER BY created_at ASC LIMIT 1;
  IF v_uid IS NULL THEN
    SELECT id INTO v_uid FROM auth.users ORDER BY created_at ASC LIMIT 1;
  END IF;
  IF v_uid IS NULL THEN RETURN; END IF;
  FOR f IN 1..4 LOOP
    FOR r IN 1..6 LOOP
      rn := (f::text || lpad(r::text, 2, '0'));
      rt := CASE WHEN r = 6 THEN 'Mapple' ELSE 'Oak' END;
      INSERT INTO public.rooms (user_id, room_number, floor, room_type)
      VALUES (v_uid, rn, f, rt)
      ON CONFLICT (room_number) DO NOTHING;
    END LOOP;
  END LOOP;
END $$;
