
INSERT INTO public.permissions (key, label, module, sort_order) VALUES
  ('reporting.housekeeping.view',   'Housekeeping Reporting — View',   'Reporting', 620),
  ('reporting.housekeeping.export', 'Housekeeping Reporting — Export', 'Reporting', 621),
  ('reporting.laundry.view',        'Laundry Reporting — View',        'Reporting', 622),
  ('reporting.laundry.export',      'Laundry Reporting — Export',      'Reporting', 623)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.role_permissions (role_key, permission_key) VALUES
  ('admin','reporting.housekeeping.view'),
  ('admin','reporting.housekeeping.export'),
  ('admin','reporting.laundry.view'),
  ('admin','reporting.laundry.export'),
  ('owner','reporting.housekeeping.view'),
  ('owner','reporting.housekeeping.export'),
  ('owner','reporting.laundry.view'),
  ('owner','reporting.laundry.export'),
  ('staff','reporting.housekeeping.view'),
  ('staff','reporting.laundry.view'),
  ('reception','reporting.housekeeping.view'),
  ('reception','reporting.laundry.view')
ON CONFLICT DO NOTHING;
