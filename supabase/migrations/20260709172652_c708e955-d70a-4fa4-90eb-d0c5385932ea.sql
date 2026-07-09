
-- 1) ROLES CATALOG
INSERT INTO public.roles (key, label, description, is_system, sort_order) VALUES
  ('fo_staff',     'Front Office', 'Reception + hosting (Front Office Staff).', true, 30),
  ('housekeeping', 'Housekeeping', 'Cleaning & service task engine.',           true, 40)
ON CONFLICT (key) DO UPDATE SET label = EXCLUDED.label,
                                description = EXCLUDED.description,
                                is_system = true,
                                sort_order = EXCLUDED.sort_order;

-- Remap grants BEFORE removing legacy role rows.
INSERT INTO public.role_permissions (role_key, permission_key)
SELECT 'housekeeping', permission_key FROM public.role_permissions WHERE role_key = 'staff'
ON CONFLICT (role_key, permission_key) DO NOTHING;
DELETE FROM public.role_permissions WHERE role_key = 'staff';

INSERT INTO public.role_permissions (role_key, permission_key)
SELECT 'fo_staff', permission_key FROM public.role_permissions WHERE role_key = 'reception'
ON CONFLICT (role_key, permission_key) DO NOTHING;
DELETE FROM public.role_permissions WHERE role_key = 'reception';

-- Clear is_system so protect_system_roles allows deletion.
UPDATE public.roles SET is_system = false WHERE key IN ('staff','reception');
DELETE FROM public.roles WHERE key IN ('staff','reception');

UPDATE public.roles SET label = 'Admin', sort_order = 10, is_system = true WHERE key = 'admin';
UPDATE public.roles SET label = 'Owner', sort_order = 20, is_system = true WHERE key = 'owner';

-- 2) LEGACY ENUM
COMMENT ON TYPE public.app_role IS
  'HEOS v1.0 role model: admin | owner | fo_staff | housekeeping. '
  'Legacy values ''reception'' and ''staff'' are DEPRECATED — kept only for '
  'schema compatibility with historical audit rows. Writing them is blocked '
  'by user_roles_block_legacy_role trigger.';

CREATE OR REPLACE FUNCTION public.user_roles_block_legacy_role()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.role::text IN ('reception','staff') THEN
    RAISE EXCEPTION 'Role % is deprecated. Use fo_staff or housekeeping.', NEW.role
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_user_roles_block_legacy ON public.user_roles;
CREATE TRIGGER trg_user_roles_block_legacy
  BEFORE INSERT OR UPDATE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.user_roles_block_legacy_role();

-- 3) QUOTES + FOLLOW-UPS DORMANT
COMMENT ON TABLE public.quotes IS
  'DEPRECATED (HEOS v1.0). Quotes module removed 2026-07-09. Kept for historical reference — do not query from application code.';
COMMENT ON TABLE public.quote_items IS 'DEPRECATED — see public.quotes.';
COMMENT ON TABLE public.quote_activities IS 'DEPRECATED — see public.quotes.';
COMMENT ON TABLE public.followups IS
  'DEPRECATED (HEOS v1.0). Follow-ups were quote-scoped and removed with Quotes. Kept for historical reference.';

REVOKE INSERT, UPDATE, DELETE ON public.quotes           FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.quote_items      FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.quote_activities FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.followups        FROM authenticated;

-- 4) PERMISSION AUDIT
DELETE FROM public.role_permissions
  WHERE permission_key IN (
    'quotes.view','quotes.create','quotes.edit','quotes.delete',
    'cash.manage','master.rates','master.rooms','master.others'
  );
DELETE FROM public.permissions
  WHERE key IN (
    'quotes.view','quotes.create','quotes.edit','quotes.delete',
    'cash.manage','master.rates','master.rooms','master.others'
  );

INSERT INTO public.permissions (module, key, label, description, sort_order) VALUES
  ('Operations',   'operations.charge_catalog', 'Charge Catalogue',        'Manage add-on charge catalogue used in booking items.',     410),
  ('Operations',   'operations.hk_issue_types', 'Housekeeping Issue Types','Manage the list of HK issue reasons.',                       420),
  ('Operations',   'operations.linen_types',    'Linen Types',             'Manage linen master used in laundry batches.',               430),
  ('Operations',   'operations.inventory',      'Inventory',               'View and manage inventory items and movements.',             440),
  ('Operations',   'operations.vendors',        'Vendors',                 'Manage vendors used in expenses and inventory purchases.',   450),
  ('Housekeeping', 'housekeeping.view',         'View Housekeeping',       'View housekeeping task board.',                              510),
  ('Housekeeping', 'housekeeping.work',         'Perform Housekeeping',    'Claim and complete housekeeping tasks.',                     520),
  ('Laundry',      'laundry.view',              'View Laundry',            'View laundry queue and batches.',                            610),
  ('Laundry',      'laundry.manage',            'Manage Laundry',          'Create batches, edit metadata, mark returned/damaged/lost.', 620),
  ('Night Audit',  'night_audit.run',           'Run Night Audit',         'Execute the Night Audit close and advance business date.',   710),
  ('Guest Portal', 'guest_portal.ops_view',     'View Guest Portal (Ops)', 'Open guest portal from ops surfaces to assist guests.',      810)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.role_permissions (role_key, permission_key)
SELECT r, p FROM (VALUES
  ('admin','operations.charge_catalog'),
  ('admin','operations.hk_issue_types'),
  ('admin','operations.linen_types'),
  ('admin','operations.inventory'),
  ('admin','operations.vendors'),
  ('admin','housekeeping.view'),
  ('admin','housekeeping.work'),
  ('admin','laundry.view'),
  ('admin','laundry.manage'),
  ('admin','night_audit.run'),
  ('admin','guest_portal.ops_view'),
  ('owner','operations.charge_catalog'),
  ('owner','operations.hk_issue_types'),
  ('owner','operations.linen_types'),
  ('owner','operations.inventory'),
  ('owner','operations.vendors'),
  ('owner','housekeeping.view'),
  ('owner','laundry.view'),
  ('owner','night_audit.run'),
  ('owner','guest_portal.ops_view'),
  ('fo_staff','housekeeping.view'),
  ('fo_staff','laundry.view'),
  ('fo_staff','night_audit.run'),
  ('fo_staff','guest_portal.ops_view'),
  ('housekeeping','housekeeping.view'),
  ('housekeeping','housekeeping.work'),
  ('housekeeping','laundry.view'),
  ('housekeeping','laundry.manage')
) t(r,p)
ON CONFLICT (role_key, permission_key) DO NOTHING;
