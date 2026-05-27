
-- 1) Roles
DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('admin', 'staff');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(auth.uid(), 'admin')
$$;

DROP POLICY IF EXISTS user_roles_select_all ON public.user_roles;
CREATE POLICY user_roles_select_all ON public.user_roles FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS user_roles_admin_write ON public.user_roles;
CREATE POLICY user_roles_admin_write ON public.user_roles FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- Seed admin
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin'::public.app_role FROM auth.users
WHERE lower(email) = lower('shobhan.india@gmail.com')
ON CONFLICT (user_id, role) DO NOTHING;

-- 2) Shared visibility / write on operational tables
-- QUOTES
DROP POLICY IF EXISTS quotes_select_own ON public.quotes;
DROP POLICY IF EXISTS quotes_insert_own ON public.quotes;
DROP POLICY IF EXISTS quotes_update_own ON public.quotes;
DROP POLICY IF EXISTS quotes_delete_own ON public.quotes;
CREATE POLICY quotes_select_all ON public.quotes FOR SELECT TO authenticated USING (true);
CREATE POLICY quotes_insert_auth ON public.quotes FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY quotes_update_auth ON public.quotes FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY quotes_delete_admin ON public.quotes FOR DELETE TO authenticated USING (public.is_admin());

-- CUSTOMERS
DROP POLICY IF EXISTS customers_select_own ON public.customers;
DROP POLICY IF EXISTS customers_insert_own ON public.customers;
DROP POLICY IF EXISTS customers_update_own ON public.customers;
DROP POLICY IF EXISTS customers_delete_own ON public.customers;
CREATE POLICY customers_select_all ON public.customers FOR SELECT TO authenticated USING (true);
CREATE POLICY customers_insert_auth ON public.customers FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY customers_update_auth ON public.customers FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY customers_delete_admin ON public.customers FOR DELETE TO authenticated USING (public.is_admin());

-- QUOTE ACTIVITIES
DROP POLICY IF EXISTS activities_select_own ON public.quote_activities;
DROP POLICY IF EXISTS activities_insert_auth ON public.quote_activities;
CREATE POLICY activities_select_all ON public.quote_activities FOR SELECT TO authenticated USING (true);
CREATE POLICY activities_insert_auth ON public.quote_activities FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- FOLLOWUPS
DROP POLICY IF EXISTS followups_select_own ON public.followups;
DROP POLICY IF EXISTS followups_insert_own ON public.followups;
DROP POLICY IF EXISTS followups_update_own ON public.followups;
DROP POLICY IF EXISTS followups_delete_own ON public.followups;
CREATE POLICY followups_select_all ON public.followups FOR SELECT TO authenticated USING (true);
CREATE POLICY followups_insert_auth ON public.followups FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY followups_update_auth ON public.followups FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY followups_delete_admin ON public.followups FOR DELETE TO authenticated USING (public.is_admin() OR auth.uid() = user_id);

-- TASKS
DROP POLICY IF EXISTS tasks_select_own ON public.tasks;
DROP POLICY IF EXISTS tasks_insert_own ON public.tasks;
DROP POLICY IF EXISTS tasks_update_own ON public.tasks;
DROP POLICY IF EXISTS tasks_delete_own ON public.tasks;
CREATE POLICY tasks_select_all ON public.tasks FOR SELECT TO authenticated USING (true);
CREATE POLICY tasks_insert_auth ON public.tasks FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY tasks_update_auth ON public.tasks FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY tasks_delete_admin ON public.tasks FOR DELETE TO authenticated USING (public.is_admin() OR auth.uid() = user_id);

-- PROFILES: everyone signed-in should see staff names for "Created By"
DROP POLICY IF EXISTS profiles_select_all ON public.profiles;
CREATE POLICY profiles_select_all ON public.profiles FOR SELECT TO authenticated USING (true);
