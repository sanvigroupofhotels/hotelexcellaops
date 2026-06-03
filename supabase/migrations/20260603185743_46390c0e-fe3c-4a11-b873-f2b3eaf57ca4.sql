
-- Expand booking_status enum with payment/lifecycle stages
ALTER TYPE booking_status ADD VALUE IF NOT EXISTS 'Advance Paid';
ALTER TYPE booking_status ADD VALUE IF NOT EXISTS 'Full Paid';
ALTER TYPE booking_status ADD VALUE IF NOT EXISTS 'Stay Completed';

-- Bookings: track advance payment
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS advance_paid numeric NOT NULL DEFAULT 0;

-- Quote items: bring to parity with primary quote line
ALTER TABLE public.quote_items ADD COLUMN IF NOT EXISTS rooms integer NOT NULL DEFAULT 1;
ALTER TABLE public.quote_items ADD COLUMN IF NOT EXISTS early_check_in boolean NOT NULL DEFAULT false;
ALTER TABLE public.quote_items ADD COLUMN IF NOT EXISTS early_check_in_slot text;
ALTER TABLE public.quote_items ADD COLUMN IF NOT EXISTS late_check_out boolean NOT NULL DEFAULT false;
ALTER TABLE public.quote_items ADD COLUMN IF NOT EXISTS late_check_out_slot text;
ALTER TABLE public.quote_items ADD COLUMN IF NOT EXISTS pet_size text NOT NULL DEFAULT 'none';
ALTER TABLE public.quote_items ADD COLUMN IF NOT EXISTS extra_adults integer NOT NULL DEFAULT 0;
ALTER TABLE public.quote_items ADD COLUMN IF NOT EXISTS drivers integer NOT NULL DEFAULT 0;

-- Booking items: same parity
ALTER TABLE public.booking_items ADD COLUMN IF NOT EXISTS rooms integer NOT NULL DEFAULT 1;
ALTER TABLE public.booking_items ADD COLUMN IF NOT EXISTS early_check_in boolean NOT NULL DEFAULT false;
ALTER TABLE public.booking_items ADD COLUMN IF NOT EXISTS early_check_in_slot text;
ALTER TABLE public.booking_items ADD COLUMN IF NOT EXISTS late_check_out boolean NOT NULL DEFAULT false;
ALTER TABLE public.booking_items ADD COLUMN IF NOT EXISTS late_check_out_slot text;
ALTER TABLE public.booking_items ADD COLUMN IF NOT EXISTS pet_size text NOT NULL DEFAULT 'none';
ALTER TABLE public.booking_items ADD COLUMN IF NOT EXISTS extra_adults integer NOT NULL DEFAULT 0;
ALTER TABLE public.booking_items ADD COLUMN IF NOT EXISTS drivers integer NOT NULL DEFAULT 0;
