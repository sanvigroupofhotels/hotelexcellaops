
-- Add reception role to access matrix
INSERT INTO public.roles (key, label, description, is_system, sort_order)
VALUES ('reception', 'Reception', 'Front-desk reception staff: House View, customers, complaints, cash.', true, 25)
ON CONFLICT (key) DO NOTHING;

-- Default permission seed for reception
INSERT INTO public.role_permissions (role_key, permission_key) VALUES
  ('reception', 'house_view.view'),
  ('reception', 'customers.view'),
  ('reception', 'customers.edit'),
  ('reception', 'complaints.view'),
  ('reception', 'complaints.manage'),
  ('reception', 'tasks.view'),
  ('reception', 'tasks.manage'),
  ('reception', 'cash.view'),
  ('reception', 'cash.manage'),
  ('reception', 'rates.view'),
  ('reception', 'rooms.view')
ON CONFLICT DO NOTHING;

-- Remove Bookings list visibility from Staff (House View remains)
DELETE FROM public.role_permissions
WHERE role_key = 'staff'
  AND permission_key IN ('bookings.view', 'bookings.create', 'bookings.edit', 'bookings.delete');
