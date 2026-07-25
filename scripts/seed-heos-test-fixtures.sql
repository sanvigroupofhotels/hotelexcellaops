-- HEOS_TEST_* rehearsal dataset (Milestone 0 / 1 e2e suite).
--
-- Deterministic, idempotent seed for the room-move regression + full-lifecycle
-- scenarios in tests/e2e/room-move-regression.spec.py. Every UUID is stable so
-- CI can hard-code HEOS_TEST_* env vars and run headless.
--
-- Run:  psql "$SUPABASE_DB_URL" -f scripts/seed-heos-test-fixtures.sql
--
-- Emits the env-var block on stdout; copy it into the CI job.
--
-- Fixtures created:
--   • Rooms 102 / 104 / 105 (Standard) — reused if they already exist by room_number.
--   • Customer "HEOS Test Guest".
--   • Booking A (single-room) with 1 booking_item on Room 102.
--   • Booking B (multi-room) with 2 booking_items on Room 104 + Room 105.
--
-- The script is safe to re-run: every insert uses ON CONFLICT DO NOTHING against
-- the stable UUID key, then updates the mutable fields back to a known baseline.

BEGIN;

-- Stable UUIDs — namespaced under 'heos-test-*'.
-- Rooms
INSERT INTO public.rooms (id, room_number, room_type, active, housekeeping_status)
VALUES
  ('11111111-1111-4111-8111-000000000102', '102', 'Standard Room', true, 'ready'),
  ('11111111-1111-4111-8111-000000000104', '104', 'Standard Room', true, 'ready'),
  ('11111111-1111-4111-8111-000000000105', '105', 'Standard Room', true, 'ready')
ON CONFLICT (id) DO UPDATE SET
  active = EXCLUDED.active,
  housekeeping_status = 'ready';

-- Customer
INSERT INTO public.customers (id, guest_name, phone, customer_reference)
VALUES ('22222222-2222-4222-8222-000000000001', 'HEOS Test Guest', '+91 90000 00001', 'HEOS-TEST-CUST-1')
ON CONFLICT (id) DO UPDATE SET guest_name = EXCLUDED.guest_name;

-- Booking A — single room, future stay
INSERT INTO public.bookings (
  id, customer_id, booking_reference, check_in, check_out, status, amount, advance_paid
) VALUES (
  '33333333-3333-4333-8333-00000000000A',
  '22222222-2222-4222-8222-000000000001',
  'HEOS-TEST-A',
  (CURRENT_DATE + INTERVAL '2 day')::date,
  (CURRENT_DATE + INTERVAL '5 day')::date,
  'Confirmed', 0, 0
)
ON CONFLICT (id) DO UPDATE SET
  check_in = EXCLUDED.check_in,
  check_out = EXCLUDED.check_out,
  status = 'Confirmed';

INSERT INTO public.booking_items (
  id, booking_id, position, room_type, adults, children, check_in, check_out,
  rate, subtotal, rooms
) VALUES (
  '44444444-4444-4444-8444-00000000000A',
  '33333333-3333-4333-8333-00000000000A',
  0, 'Standard Room', 2, 0,
  (CURRENT_DATE + INTERVAL '2 day')::date,
  (CURRENT_DATE + INTERVAL '5 day')::date,
  0, 0, 1
)
ON CONFLICT (id) DO UPDATE SET
  check_in = EXCLUDED.check_in,
  check_out = EXCLUDED.check_out,
  item_status = 'Confirmed',
  checked_in_at = NULL,
  checked_out_at = NULL,
  assigned_room_id = NULL;

-- Booking B — multi-room future stay (moving item + quiet sibling)
INSERT INTO public.bookings (
  id, customer_id, booking_reference, check_in, check_out, status, amount, advance_paid
) VALUES (
  '33333333-3333-4333-8333-00000000000B',
  '22222222-2222-4222-8222-000000000001',
  'HEOS-TEST-B',
  (CURRENT_DATE + INTERVAL '2 day')::date,
  (CURRENT_DATE + INTERVAL '5 day')::date,
  'Confirmed', 0, 0
)
ON CONFLICT (id) DO UPDATE SET
  check_in = EXCLUDED.check_in,
  check_out = EXCLUDED.check_out,
  status = 'Confirmed';

INSERT INTO public.booking_items (
  id, booking_id, position, room_type, adults, children, check_in, check_out,
  rate, subtotal, rooms
) VALUES
  ('44444444-4444-4444-8444-00000000000B',
   '33333333-3333-4333-8333-00000000000B', 0,
   'Standard Room', 2, 0,
   (CURRENT_DATE + INTERVAL '2 day')::date,
   (CURRENT_DATE + INTERVAL '5 day')::date,
   0, 0, 1),
  ('44444444-4444-4444-8444-00000000000C',
   '33333333-3333-4333-8333-00000000000B', 1,
   'Standard Room', 2, 0,
   (CURRENT_DATE + INTERVAL '2 day')::date,
   (CURRENT_DATE + INTERVAL '5 day')::date,
   0, 0, 1)
ON CONFLICT (id) DO UPDATE SET
  check_in = EXCLUDED.check_in,
  check_out = EXCLUDED.check_out,
  item_status = 'Confirmed',
  checked_in_at = NULL,
  checked_out_at = NULL,
  assigned_room_id = NULL;

-- Clear any prior assignments so each run starts from a clean slate.
DELETE FROM public.booking_room_assignments
WHERE booking_id IN (
  '33333333-3333-4333-8333-00000000000A',
  '33333333-3333-4333-8333-00000000000B'
);

-- Seed initial assignments.
INSERT INTO public.booking_room_assignments (booking_id, item_id, room_id, start_date, end_date)
VALUES
  ('33333333-3333-4333-8333-00000000000A',
   '44444444-4444-4444-8444-00000000000A',
   '11111111-1111-4111-8111-000000000102',
   (CURRENT_DATE + INTERVAL '2 day')::date,
   (CURRENT_DATE + INTERVAL '5 day')::date),
  ('33333333-3333-4333-8333-00000000000B',
   '44444444-4444-4444-8444-00000000000B',
   '11111111-1111-4111-8111-000000000104',
   (CURRENT_DATE + INTERVAL '2 day')::date,
   (CURRENT_DATE + INTERVAL '5 day')::date),
  ('33333333-3333-4333-8333-00000000000B',
   '44444444-4444-4444-8444-00000000000C',
   '11111111-1111-4111-8111-000000000105',
   (CURRENT_DATE + INTERVAL '2 day')::date,
   (CURRENT_DATE + INTERVAL '5 day')::date);

UPDATE public.booking_items SET assigned_room_id = '11111111-1111-4111-8111-000000000102'
 WHERE id = '44444444-4444-4444-8444-00000000000A';
UPDATE public.booking_items SET assigned_room_id = '11111111-1111-4111-8111-000000000104'
 WHERE id = '44444444-4444-4444-8444-00000000000B';
UPDATE public.booking_items SET assigned_room_id = '11111111-1111-4111-8111-000000000105'
 WHERE id = '44444444-4444-4444-8444-00000000000C';

COMMIT;

\echo ''
\echo '===== HEOS_TEST_* env vars ====='
\echo 'export HEOS_TEST_BUSINESS_DATE=$(date +%F)'
\echo 'export HEOS_TEST_BOOKING_A=33333333-3333-4333-8333-00000000000A'
\echo 'export HEOS_TEST_ITEM_A=44444444-4444-4444-8444-00000000000A'
\echo 'export HEOS_TEST_BOOKING_B=33333333-3333-4333-8333-00000000000B'
\echo 'export HEOS_TEST_ITEM_B_MOVING=44444444-4444-4444-8444-00000000000B'
\echo 'export HEOS_TEST_ITEM_B_QUIET=44444444-4444-4444-8444-00000000000C'
\echo 'export HEOS_TEST_ROOM_102=11111111-1111-4111-8111-000000000102'
\echo 'export HEOS_TEST_ROOM_104=11111111-1111-4111-8111-000000000104'
\echo 'export HEOS_TEST_ROOM_105=11111111-1111-4111-8111-000000000105'
\echo '================================='
