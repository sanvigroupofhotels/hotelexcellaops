ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS taxes_included boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS total_override numeric NULL;

ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS taxes_included boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS total_override numeric NULL;