-- Restore Master Data permissions removed by 20260709172652.
INSERT INTO public.permissions (module, key, label, description, sort_order) VALUES
  ('Master Data', 'master.rooms',  'Rooms',         'Manage the rooms master.',                                       910),
  ('Master Data', 'master.rates',  'Rates',         'Manage rate plans and pricing master.',                          911),
  ('Master Data', 'master.others', 'Other Masters', 'Lead sources, expense types, complaint categories, tags, etc.', 912)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.role_permissions (role_key, permission_key)
SELECT r, p FROM (VALUES
  ('admin','master.rooms'),  ('admin','master.rates'),  ('admin','master.others'),
  ('owner','master.rooms'),  ('owner','master.rates'),  ('owner','master.others')
) t(r,p)
ON CONFLICT DO NOTHING;