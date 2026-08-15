ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS expected_departure_at timestamptz;

COMMENT ON COLUMN public.bookings.expected_arrival_at IS 'Actual expected arrival time provided by guest/staff. Input to the Early Check-In pricing engine; NOT the standard check-in time.';
COMMENT ON COLUMN public.bookings.expected_departure_at IS 'Actual expected departure time provided by guest/staff. Input to the Late Check-Out pricing engine; NOT the standard check-out time.';