
-- ROLES catalogue
CREATE TABLE public.roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  label text NOT NULL,
  description text,
  is_system boolean NOT NULL DEFAULT false,
  sort_order int NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.roles TO authenticated;
GRANT ALL ON public.roles TO service_role;
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "roles read auth" ON public.roles FOR SELECT TO authenticated USING (true);
CREATE POLICY "roles admin write" ON public.roles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- PERMISSIONS catalogue
CREATE TABLE public.permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module text NOT NULL,
  key text NOT NULL UNIQUE,
  label text NOT NULL,
  description text,
  sort_order int NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.permissions TO authenticated;
GRANT ALL ON public.permissions TO service_role;
ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "permissions read auth" ON public.permissions FOR SELECT TO authenticated USING (true);
CREATE POLICY "permissions admin write" ON public.permissions FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- MATRIX
CREATE TABLE public.role_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role_key text NOT NULL REFERENCES public.roles(key) ON DELETE CASCADE ON UPDATE CASCADE,
  permission_key text NOT NULL REFERENCES public.permissions(key) ON DELETE CASCADE ON UPDATE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (role_key, permission_key)
);
GRANT SELECT ON public.role_permissions TO authenticated;
GRANT ALL ON public.role_permissions TO service_role;
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rp read auth" ON public.role_permissions FOR SELECT TO authenticated USING (true);
CREATE POLICY "rp admin write" ON public.role_permissions FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- updated_at trigger
CREATE TRIGGER roles_set_updated_at BEFORE UPDATE ON public.roles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Seed system roles
INSERT INTO public.roles(key, label, description, is_system, sort_order) VALUES
  ('admin', 'Admin', 'Full system access', true, 1),
  ('owner', 'Owner', 'Property owner — operational access', true, 2),
  ('staff', 'Staff', 'Front-desk / day-to-day operations', true, 3)
ON CONFLICT (key) DO NOTHING;

-- Seed permissions catalogue
INSERT INTO public.permissions(module, key, label, description, sort_order) VALUES
  ('Bookings','bookings.view','View Bookings','See bookings list & details',10),
  ('Bookings','bookings.create','Create Bookings','Create new bookings',11),
  ('Bookings','bookings.edit','Edit Bookings','Edit booking details',12),
  ('Bookings','bookings.delete','Delete Bookings','Cancel or delete bookings',13),
  ('Quotes','quotes.view','View Quotes','See quotes',20),
  ('Quotes','quotes.create','Create Quotes','Generate new quotes',21),
  ('Quotes','quotes.edit','Edit Quotes','Edit quote details',22),
  ('Quotes','quotes.delete','Delete Quotes','Delete quotes',23),
  ('Customers','customers.view','View Customers','See customers list',30),
  ('Customers','customers.edit','Edit Customers','Edit customer profiles',31),
  ('Rooms','rooms.view','View Rooms','See rooms list',40),
  ('Rooms','rooms.manage','Manage Rooms','Add/edit/block rooms',41),
  ('Rates','rates.view','View Rates','See rate plans',50),
  ('Rates','rates.manage','Manage Rates','Edit rate plans & overrides',51),
  ('Cash','cash.view','View Cash','See cash transactions',60),
  ('Cash','cash.manage','Manage Cash','Add/edit cash transactions',61),
  ('Reports','reports.view','View Reports','Reports & analytics',70),
  ('Master Data','master_data.manage','Manage Master Data','Edit dropdowns & catalogues',80),
  ('House View','house_view.view','View House View','See house occupancy view',90),
  ('Complaints','complaints.view','View Complaints','See complaints',100),
  ('Complaints','complaints.manage','Manage Complaints','Resolve & edit complaints',101),
  ('Tasks','tasks.view','View Tasks','See tasks',110),
  ('Tasks','tasks.manage','Manage Tasks','Create / complete tasks',111),
  ('Users','users.manage','Manage Users','Create/edit users & roles',900),
  ('Access','access.manage','Manage Access Settings','Edit role-permission matrix',901)
ON CONFLICT (key) DO NOTHING;

-- Seed default matrix
-- Admin: all
INSERT INTO public.role_permissions(role_key, permission_key)
SELECT 'admin', key FROM public.permissions
ON CONFLICT DO NOTHING;

-- Owner: all except users.manage and access.manage
INSERT INTO public.role_permissions(role_key, permission_key)
SELECT 'owner', key FROM public.permissions
WHERE key NOT IN ('users.manage','access.manage')
ON CONFLICT DO NOTHING;

-- Staff: limited set
INSERT INTO public.role_permissions(role_key, permission_key) VALUES
  ('staff','bookings.view'),('staff','bookings.create'),('staff','bookings.edit'),
  ('staff','quotes.view'),('staff','quotes.create'),('staff','quotes.edit'),
  ('staff','customers.view'),('staff','customers.edit'),
  ('staff','tasks.view'),('staff','tasks.manage'),
  ('staff','complaints.view'),
  ('staff','house_view.view')
ON CONFLICT DO NOTHING;

-- has_permission function
CREATE OR REPLACE FUNCTION public.has_permission(_user_id uuid, _permission_key text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.role_permissions rp ON rp.role_key = ur.role::text
    WHERE ur.user_id = _user_id
      AND rp.permission_key = _permission_key
  )
$$;

-- Helper: get current user's permissions (for client)
CREATE OR REPLACE FUNCTION public.my_permissions()
RETURNS SETOF text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT rp.permission_key
  FROM public.user_roles ur
  JOIN public.role_permissions rp ON rp.role_key = ur.role::text
  WHERE ur.user_id = auth.uid()
$$;

-- Prevent deletion / key-rename of system roles
CREATE OR REPLACE FUNCTION public.protect_system_roles()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.is_system THEN
    RAISE EXCEPTION 'Cannot delete system role %', OLD.key;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.is_system AND OLD.key <> NEW.key THEN
    RAISE EXCEPTION 'Cannot rename system role key %', OLD.key;
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

CREATE TRIGGER roles_protect_system
  BEFORE UPDATE OR DELETE ON public.roles
  FOR EACH ROW EXECUTE FUNCTION public.protect_system_roles();
