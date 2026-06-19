
-- 1) Expand the permissions catalog (idempotent upserts by key)
INSERT INTO public.permissions (module, key, label, description, sort_order) VALUES
  ('Dashboard',    'dashboard.view',            'View Dashboard',        'Access the home dashboard', 10),

  ('Bookings',     'bookings.view',             'View Bookings',         'See the bookings list', 110),
  ('Bookings',     'bookings.create',           'Create Bookings',       'Create new bookings', 111),
  ('Bookings',     'bookings.edit',             'Edit Bookings',         'Edit existing bookings', 112),
  ('Bookings',     'bookings.delete',           'Delete Bookings',       'Delete bookings', 113),

  ('House View',   'house_view.view',           'View House View',       'See the house grid', 210),
  ('House View',   'house_view.checkin',        'Check-In',              'Check guests in', 211),
  ('House View',   'house_view.checkout',       'Check-Out',             'Check guests out', 212),
  ('House View',   'house_view.add_charges',    'Add Charges',           'Add in-house charges', 213),
  ('House View',   'house_view.add_payments',   'Add Payments',          'Record booking payments', 214),
  ('House View',   'house_view.extend_stay',    'Extend Stay',           'Extend a guest stay', 215),
  ('House View',   'house_view.night_audit',    'Night Audit',           'Run/close night audit', 216),

  ('Customers',    'customers.view',            'View Customers',        '', 310),
  ('Customers',    'customers.create',          'Create Customers',      '', 311),
  ('Customers',    'customers.edit',            'Edit Customers',        '', 312),
  ('Customers',    'customers.delete',          'Delete Customers',      '', 313),

  ('Cashbook',     'cash.view',                 'View Cashbook',         '', 410),
  ('Cashbook',     'cash.add_income',           'Add Income',            'Record cash collections', 411),
  ('Cashbook',     'cash.add_expense',          'Add Expense',           'Record cash expenses', 412),
  ('Cashbook',     'cash.audit_close',          'Audit Close',           'Close / reopen cash audit', 413),

  ('Due Collection','dues.view',                'View Due Collection',   '', 510),
  ('Due Collection','dues.receive_payment',     'Receive Payment',       'Collect against dues', 511),

  ('Reporting',    'reporting.analytics.view',  'Analytics — View',      '', 610),
  ('Reporting',    'reporting.analytics.export','Analytics — Export',    '', 611),
  ('Reporting',    'reporting.payments.view',   'Payment Reports — View','', 612),
  ('Reporting',    'reporting.payments.export', 'Payment Reports — Export','', 613),
  ('Reporting',    'reporting.staff.view',      'Staff Reporting — View','', 614),
  ('Reporting',    'reporting.staff.export',    'Staff Reporting — Export','', 615),
  ('Reporting',    'reporting.night_audit.view','Night Audit History',   '', 616),

  ('Complaints',   'complaints.view',           'View Complaints',       '', 710),
  ('Complaints',   'complaints.create',         'Create Complaints',     '', 711),
  ('Complaints',   'complaints.assign',         'Assign Complaints',     '', 712),
  ('Complaints',   'complaints.close',          'Close Complaints',      '', 713),

  ('Staff Management','staff.master',           'Staff Master',          'View/edit staff records', 810),
  ('Staff Management','staff.attendance',       'Staff Attendance',      '', 811),
  ('Staff Management','staff.salary',           'Staff Salary',          '', 812),

  ('Master Data',  'master.rooms',              'Rooms',                 '', 910),
  ('Master Data',  'master.rates',              'Rates',                 '', 911),
  ('Master Data',  'master.others',             'Other Masters',         'Lead sources, expense types, complaint categories etc.', 912),

  ('Settings',     'settings.general',          'General',               '', 1010),
  ('Settings',     'settings.operations',       'Operations',            '', 1011),
  ('Settings',     'settings.branding',         'Branding',              '', 1012),
  ('Settings',     'settings.documents',        'Documents Retention',   '', 1013),
  ('Settings',     'settings.payment_settings', 'Payment Settings',      '', 1014),
  ('Settings',     'settings.integrations',     'Integrations',          '', 1015),

  ('Users',        'users.manage_users',        'User Management',       'Create/edit users, assign roles, reset passwords', 1110),
  ('Users',        'users.manage_roles',        'Role Management',       'Create/edit roles and permission matrix', 1111),
  ('Users',        'users.manage_access',       'Access Management',     'Apply per-user permission overrides', 1112)
ON CONFLICT (key) DO UPDATE
SET module = EXCLUDED.module,
    label = EXCLUDED.label,
    description = EXCLUDED.description,
    sort_order = EXCLUDED.sort_order;

-- 2) Grant ALL permissions to admin role (idempotent)
INSERT INTO public.role_permissions (role_key, permission_key)
SELECT 'admin', key FROM public.permissions
ON CONFLICT DO NOTHING;

-- 3) Seed sensible defaults for Owner (everything except user/role/access management)
INSERT INTO public.role_permissions (role_key, permission_key)
SELECT 'owner', key FROM public.permissions
WHERE module <> 'Users'
ON CONFLICT DO NOTHING;

-- 4) Reception baseline (House View ops, Customers, Cashbook view, Dues, Complaints)
INSERT INTO public.role_permissions (role_key, permission_key) VALUES
  ('reception','dashboard.view'),
  ('reception','house_view.view'),
  ('reception','house_view.checkin'),
  ('reception','house_view.checkout'),
  ('reception','house_view.add_charges'),
  ('reception','house_view.add_payments'),
  ('reception','house_view.extend_stay'),
  ('reception','customers.view'),
  ('reception','customers.create'),
  ('reception','customers.edit'),
  ('reception','cash.view'),
  ('reception','cash.add_income'),
  ('reception','dues.view'),
  ('reception','dues.receive_payment'),
  ('reception','complaints.view'),
  ('reception','complaints.create')
ON CONFLICT DO NOTHING;

-- 5) Staff minimal baseline
INSERT INTO public.role_permissions (role_key, permission_key) VALUES
  ('staff','dashboard.view'),
  ('staff','house_view.view'),
  ('staff','customers.view'),
  ('staff','complaints.view'),
  ('staff','complaints.create')
ON CONFLICT DO NOTHING;

-- 6) Per-user override table
CREATE TABLE IF NOT EXISTS public.user_permission_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  permission_key TEXT NOT NULL REFERENCES public.permissions(key) ON DELETE CASCADE ON UPDATE CASCADE,
  granted BOOLEAN NOT NULL,
  expires_at TIMESTAMPTZ NULL,
  notes TEXT NULL,
  created_by UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, permission_key)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_permission_overrides TO authenticated;
GRANT ALL ON public.user_permission_overrides TO service_role;

ALTER TABLE public.user_permission_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_overrides_admin_all" ON public.user_permission_overrides;
CREATE POLICY "user_overrides_admin_all"
ON public.user_permission_overrides
FOR ALL TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "user_overrides_self_read" ON public.user_permission_overrides;
CREATE POLICY "user_overrides_self_read"
ON public.user_permission_overrides
FOR SELECT TO authenticated
USING (user_id = auth.uid());

DROP TRIGGER IF EXISTS user_perm_overrides_set_updated ON public.user_permission_overrides;
CREATE TRIGGER user_perm_overrides_set_updated
BEFORE UPDATE ON public.user_permission_overrides
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_user_perm_overrides_user ON public.user_permission_overrides(user_id);

-- 7) Updated my_permissions() — role perms UNION grants MINUS denies (honoring expiry)
CREATE OR REPLACE FUNCTION public.my_permissions()
RETURNS SETOF text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $function$
  WITH role_perms AS (
    SELECT rp.permission_key AS k
    FROM public.user_roles ur
    JOIN public.role_permissions rp ON rp.role_key = ur.role::text
    WHERE ur.user_id = auth.uid()
  ),
  active_overrides AS (
    SELECT permission_key AS k, granted
    FROM public.user_permission_overrides
    WHERE user_id = auth.uid()
      AND (expires_at IS NULL OR expires_at > now())
  ),
  granted AS (
    SELECT k FROM role_perms
    UNION
    SELECT k FROM active_overrides WHERE granted = true
  ),
  denied AS (
    SELECT k FROM active_overrides WHERE granted = false
  )
  SELECT DISTINCT k FROM granted WHERE k NOT IN (SELECT k FROM denied);
$function$;

-- 8) Same logic in has_permission() so backend checks stay consistent
CREATE OR REPLACE FUNCTION public.has_permission(_user_id uuid, _permission_key text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $function$
  WITH active_overrides AS (
    SELECT granted FROM public.user_permission_overrides
    WHERE user_id = _user_id
      AND permission_key = _permission_key
      AND (expires_at IS NULL OR expires_at > now())
  )
  SELECT
    CASE
      WHEN EXISTS (SELECT 1 FROM active_overrides WHERE granted = false) THEN false
      WHEN EXISTS (SELECT 1 FROM active_overrides WHERE granted = true) THEN true
      ELSE EXISTS (
        SELECT 1
        FROM public.user_roles ur
        JOIN public.role_permissions rp ON rp.role_key = ur.role::text
        WHERE ur.user_id = _user_id
          AND rp.permission_key = _permission_key
      )
    END
$function$;

-- 9) Effective-permissions helper for an arbitrary user (admin-only via RLS on the override table; role data is open via existing has_role)
CREATE OR REPLACE FUNCTION public.user_effective_permissions(_user_id uuid)
RETURNS TABLE(permission_key text, source text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $function$
  WITH role_perms AS (
    SELECT rp.permission_key AS k
    FROM public.user_roles ur
    JOIN public.role_permissions rp ON rp.role_key = ur.role::text
    WHERE ur.user_id = _user_id
  ),
  active_overrides AS (
    SELECT permission_key AS k, granted
    FROM public.user_permission_overrides
    WHERE user_id = _user_id
      AND (expires_at IS NULL OR expires_at > now())
  )
  SELECT DISTINCT
    k AS permission_key,
    CASE
      WHEN k IN (SELECT k FROM active_overrides WHERE granted = true)  THEN 'grant'
      ELSE 'role'
    END AS source
  FROM (
    SELECT k FROM role_perms
    UNION
    SELECT k FROM active_overrides WHERE granted = true
  ) g
  WHERE k NOT IN (SELECT k FROM active_overrides WHERE granted = false);
$function$;
