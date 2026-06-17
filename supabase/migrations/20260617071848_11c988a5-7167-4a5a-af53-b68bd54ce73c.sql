
ALTER TABLE public.staff
  ADD COLUMN IF NOT EXISTS available_in_cashbook boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS available_in_dues boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS available_in_complaints boolean NOT NULL DEFAULT true;
