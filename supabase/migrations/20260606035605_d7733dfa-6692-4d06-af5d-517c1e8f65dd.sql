
-- Enums
DO $$ BEGIN
  CREATE TYPE complaint_type AS ENUM ('Room','General');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE complaint_priority AS ENUM ('Low','Medium','High','Critical');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE complaint_status AS ENUM ('Open','In Progress','Resolved');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============ complaint_categories ============
CREATE TABLE IF NOT EXISTS public.complaint_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.complaint_categories TO authenticated;
GRANT ALL ON public.complaint_categories TO service_role;
ALTER TABLE public.complaint_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY ccats_select_all ON public.complaint_categories FOR SELECT TO authenticated USING (true);
CREATE POLICY ccats_insert_admin ON public.complaint_categories FOR INSERT TO authenticated WITH CHECK (is_admin() AND auth.uid() = user_id);
CREATE POLICY ccats_update_admin ON public.complaint_categories FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY ccats_delete_admin ON public.complaint_categories FOR DELETE TO authenticated USING (is_admin());

CREATE TRIGGER ccats_set_updated_at BEFORE UPDATE ON public.complaint_categories
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Seed defaults: pick any existing user as the owner (admin will manage later)
DO $$
DECLARE v_uid uuid;
BEGIN
  SELECT id INTO v_uid FROM auth.users ORDER BY created_at ASC LIMIT 1;
  IF v_uid IS NOT NULL THEN
    INSERT INTO public.complaint_categories(user_id, name)
    SELECT v_uid, n FROM (VALUES
      ('AC'),('TV'),('WiFi'),('Geyser'),('Water'),('Housekeeping'),
      ('Noise'),('Food'),('Staff'),('Parking'),('Other')
    ) AS t(n)
    WHERE NOT EXISTS (SELECT 1 FROM public.complaint_categories WHERE name = t.n);
  END IF;
END $$;

-- ============ complaints ============
CREATE TABLE IF NOT EXISTS public.complaints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  complaint_number text NOT NULL DEFAULT ('CMP-' || upper(substring(md5(random()::text), 1, 6))),
  complaint_type complaint_type NOT NULL DEFAULT 'General',
  room_number text,
  customer_id uuid,
  booking_id uuid,
  category text NOT NULL,
  category_other text,
  priority complaint_priority NOT NULL DEFAULT 'Medium',
  status complaint_status NOT NULL DEFAULT 'Open',
  entered_by_staff_id uuid,
  entered_by_name text,
  assigned_to_staff_id uuid,
  assigned_to_name text,
  description text NOT NULL,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.complaints TO authenticated;
GRANT ALL ON public.complaints TO service_role;
ALTER TABLE public.complaints ENABLE ROW LEVEL SECURITY;

CREATE POLICY complaints_select_all ON public.complaints FOR SELECT TO authenticated USING (true);
CREATE POLICY complaints_insert_auth ON public.complaints FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY complaints_update_auth ON public.complaints FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY complaints_delete_admin ON public.complaints FOR DELETE TO authenticated USING (is_admin());

CREATE TRIGGER complaints_set_updated_at BEFORE UPDATE ON public.complaints
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS complaints_status_idx ON public.complaints(status);
CREATE INDEX IF NOT EXISTS complaints_priority_idx ON public.complaints(priority);
CREATE INDEX IF NOT EXISTS complaints_room_idx ON public.complaints(room_number);
CREATE INDEX IF NOT EXISTS complaints_created_idx ON public.complaints(created_at DESC);

-- ============ complaint_activities ============
CREATE TABLE IF NOT EXISTS public.complaint_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  complaint_id uuid NOT NULL,
  actor_id uuid,
  actor_name text,
  actor_role text,
  action text NOT NULL,
  field text,
  old_value text,
  new_value text,
  summary text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.complaint_activities TO authenticated;
GRANT ALL ON public.complaint_activities TO service_role;
ALTER TABLE public.complaint_activities ENABLE ROW LEVEL SECURITY;

CREATE POLICY cact_select_all ON public.complaint_activities FOR SELECT TO authenticated USING (true);
CREATE POLICY cact_insert_auth ON public.complaint_activities FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);

CREATE INDEX IF NOT EXISTS cact_cid_idx ON public.complaint_activities(complaint_id, created_at DESC);

-- ============ audit trigger ============
CREATE OR REPLACE FUNCTION public.complaints_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a record;
BEGIN
  SELECT * INTO a FROM public.current_actor();
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.complaint_activities(complaint_id, actor_id, actor_name, actor_role, action, summary)
    VALUES (NEW.id, a.uid, a.display_name, a.role, 'created',
      CONCAT('Created complaint · ', NEW.category, ' · ', NEW.priority::text, ' · ', NEW.status::text));
    -- auto-stamp resolved_at if created already Resolved
    IF NEW.status = 'Resolved' AND NEW.resolved_at IS NULL THEN
      UPDATE public.complaints SET resolved_at = now() WHERE id = NEW.id;
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.status IS DISTINCT FROM NEW.status THEN
      INSERT INTO public.complaint_activities(complaint_id, actor_id, actor_name, actor_role, action, field, old_value, new_value, summary)
      VALUES (NEW.id, a.uid, a.display_name, a.role, 'status_changed', 'Status', OLD.status::text, NEW.status::text, 'Status changed');
      -- stamp/clear resolved_at on transitions
      IF NEW.status = 'Resolved' AND NEW.resolved_at IS NULL THEN
        NEW.resolved_at := now();
      ELSIF NEW.status <> 'Resolved' THEN
        NEW.resolved_at := NULL;
      END IF;
    END IF;
    IF COALESCE(OLD.assigned_to_staff_id::text,'') IS DISTINCT FROM COALESCE(NEW.assigned_to_staff_id::text,'') THEN
      INSERT INTO public.complaint_activities(complaint_id, actor_id, actor_name, actor_role, action, field, old_value, new_value, summary)
      VALUES (NEW.id, a.uid, a.display_name, a.role,
        CASE WHEN OLD.assigned_to_staff_id IS NULL THEN 'assigned' ELSE 'reassigned' END,
        'Assigned To', OLD.assigned_to_name, NEW.assigned_to_name,
        CASE WHEN OLD.assigned_to_staff_id IS NULL THEN 'Assigned' ELSE 'Reassigned' END);
    END IF;
    IF OLD.priority IS DISTINCT FROM NEW.priority THEN
      INSERT INTO public.complaint_activities(complaint_id, actor_id, actor_name, actor_role, action, field, old_value, new_value, summary)
      VALUES (NEW.id, a.uid, a.display_name, a.role, 'updated', 'Priority', OLD.priority::text, NEW.priority::text, 'Priority changed');
    END IF;
    IF OLD.category IS DISTINCT FROM NEW.category THEN
      INSERT INTO public.complaint_activities(complaint_id, actor_id, actor_name, actor_role, action, field, old_value, new_value, summary)
      VALUES (NEW.id, a.uid, a.display_name, a.role, 'updated', 'Category', OLD.category, NEW.category, 'Category changed');
    END IF;
    IF COALESCE(OLD.description,'') IS DISTINCT FROM COALESCE(NEW.description,'') THEN
      INSERT INTO public.complaint_activities(complaint_id, actor_id, actor_name, actor_role, action, field, old_value, new_value, summary)
      VALUES (NEW.id, a.uid, a.display_name, a.role, 'updated', 'Description', OLD.description, NEW.description, 'Description edited');
    END IF;
    IF COALESCE(OLD.room_number,'') IS DISTINCT FROM COALESCE(NEW.room_number,'') THEN
      INSERT INTO public.complaint_activities(complaint_id, actor_id, actor_name, actor_role, action, field, old_value, new_value, summary)
      VALUES (NEW.id, a.uid, a.display_name, a.role, 'updated', 'Room', OLD.room_number, NEW.room_number, 'Room changed');
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.complaint_activities(complaint_id, actor_id, actor_name, actor_role, action, summary)
    VALUES (OLD.id, a.uid, a.display_name, a.role, 'deleted', 'Deleted complaint');
    RETURN OLD;
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS complaints_audit_ins ON public.complaints;
CREATE TRIGGER complaints_audit_ins AFTER INSERT ON public.complaints
FOR EACH ROW EXECUTE FUNCTION public.complaints_audit();

DROP TRIGGER IF EXISTS complaints_audit_upd ON public.complaints;
CREATE TRIGGER complaints_audit_upd BEFORE UPDATE ON public.complaints
FOR EACH ROW EXECUTE FUNCTION public.complaints_audit();

DROP TRIGGER IF EXISTS complaints_audit_del ON public.complaints;
CREATE TRIGGER complaints_audit_del AFTER DELETE ON public.complaints
FOR EACH ROW EXECUTE FUNCTION public.complaints_audit();
