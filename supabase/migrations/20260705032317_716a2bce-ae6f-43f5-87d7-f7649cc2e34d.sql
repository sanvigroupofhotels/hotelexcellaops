
DO $$ BEGIN CREATE TYPE public.housekeeping_status AS ENUM ('ready','dirty','cleaning','needs_service','servicing','out_of_service'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.housekeeping_task_type AS ENUM ('checkout_clean','continue_service'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.housekeeping_task_state AS ENUM ('open','in_progress','done','skipped'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.laundry_queue_state AS ENUM ('queued','sent','returned'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.hk_exception_reason AS ENUM ('service_not_required','do_not_disturb'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.rooms
  ADD COLUMN IF NOT EXISTS housekeeping_status public.housekeeping_status NOT NULL DEFAULT 'ready',
  ADD COLUMN IF NOT EXISTS hk_status_changed_at timestamptz,
  ADD COLUMN IF NOT EXISTS hk_status_changed_by uuid;

ALTER TABLE public.inventory_items
  ADD COLUMN IF NOT EXISTS show_in_housekeeping boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS hk_default_qty integer NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS public.linen_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  default_qty integer NOT NULL DEFAULT 1 CHECK (default_qty >= 1),
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.linen_types TO authenticated;
GRANT ALL ON public.linen_types TO service_role;
ALTER TABLE public.linen_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY "linen_types read authenticated" ON public.linen_types FOR SELECT TO authenticated USING (true);
CREATE POLICY "linen_types write admin/owner" ON public.linen_types FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'owner'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'owner'));
CREATE TRIGGER trg_linen_types_updated_at BEFORE UPDATE ON public.linen_types FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.hk_issue_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  default_complaint_category_id uuid REFERENCES public.complaint_categories(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.hk_issue_types TO authenticated;
GRANT ALL ON public.hk_issue_types TO service_role;
ALTER TABLE public.hk_issue_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY "hk_issue_types read authenticated" ON public.hk_issue_types FOR SELECT TO authenticated USING (true);
CREATE POLICY "hk_issue_types write admin/owner" ON public.hk_issue_types FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'owner'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'owner'));
CREATE TRIGGER trg_hk_issue_types_updated_at BEFORE UPDATE ON public.hk_issue_types FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.housekeeping_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  business_date date NOT NULL,
  type public.housekeeping_task_type NOT NULL,
  state public.housekeeping_task_state NOT NULL DEFAULT 'open',
  started_at timestamptz,
  finished_at timestamptz,
  performed_by_user_id uuid,
  performed_by_name text,
  recorded_by_user_id uuid,
  recorded_by_name text,
  skipped_reason text,
  remarks text,
  consumables_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  linen_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  issues_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.housekeeping_tasks TO authenticated;
GRANT ALL ON public.housekeeping_tasks TO service_role;
ALTER TABLE public.housekeeping_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "hk_tasks read authenticated" ON public.housekeeping_tasks FOR SELECT TO authenticated USING (true);
CREATE POLICY "hk_tasks insert authenticated" ON public.housekeeping_tasks FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "hk_tasks update authenticated" ON public.housekeeping_tasks FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "hk_tasks delete admin/owner" ON public.housekeeping_tasks FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'owner'));
CREATE UNIQUE INDEX IF NOT EXISTS hk_tasks_open_unique ON public.housekeeping_tasks (room_id, business_date, type) WHERE state IN ('open','in_progress');
CREATE INDEX IF NOT EXISTS hk_tasks_business_date_idx ON public.housekeeping_tasks (business_date, state);
CREATE INDEX IF NOT EXISTS hk_tasks_room_idx ON public.housekeeping_tasks (room_id);
CREATE TRIGGER trg_hk_tasks_updated_at BEFORE UPDATE ON public.housekeeping_tasks FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.housekeeping_room_exceptions (
  room_id uuid NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  business_date date NOT NULL,
  reason public.hk_exception_reason NOT NULL,
  set_by_user_id uuid,
  set_by_name text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, business_date)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.housekeeping_room_exceptions TO authenticated;
GRANT ALL ON public.housekeeping_room_exceptions TO service_role;
ALTER TABLE public.housekeeping_room_exceptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "hk_exc read authenticated" ON public.housekeeping_room_exceptions FOR SELECT TO authenticated USING (true);
CREATE POLICY "hk_exc write authenticated" ON public.housekeeping_room_exceptions FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_hk_exc_updated_at BEFORE UPDATE ON public.housekeeping_room_exceptions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.laundry_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  linen_type_id uuid NOT NULL REFERENCES public.linen_types(id) ON DELETE RESTRICT,
  linen_name_at_time text,
  qty integer NOT NULL DEFAULT 1 CHECK (qty >= 0),
  source_task_id uuid REFERENCES public.housekeeping_tasks(id) ON DELETE SET NULL,
  state public.laundry_queue_state NOT NULL DEFAULT 'queued',
  business_date date NOT NULL,
  actor_id uuid,
  actor_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.laundry_queue TO authenticated;
GRANT ALL ON public.laundry_queue TO service_role;
ALTER TABLE public.laundry_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "laundry_queue read authenticated" ON public.laundry_queue FOR SELECT TO authenticated USING (true);
CREATE POLICY "laundry_queue write authenticated" ON public.laundry_queue FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE INDEX IF NOT EXISTS laundry_queue_state_idx ON public.laundry_queue (state, business_date);
CREATE TRIGGER trg_laundry_queue_updated_at BEFORE UPDATE ON public.laundry_queue FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Seed a fallback "Housekeeping Report" complaint category, attributed to an existing admin user
INSERT INTO public.complaint_categories (name, active, user_id)
SELECT 'Housekeeping Report', true, ur.user_id
FROM public.user_roles ur
WHERE ur.role = 'admin'::app_role
  AND NOT EXISTS (SELECT 1 FROM public.complaint_categories WHERE lower(name) = 'housekeeping report')
LIMIT 1;
