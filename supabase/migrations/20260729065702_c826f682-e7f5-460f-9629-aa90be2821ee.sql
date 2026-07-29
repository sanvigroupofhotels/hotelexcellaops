
ALTER TABLE public.charge_catalog
  ADD COLUMN IF NOT EXISTS application_mode text NOT NULL DEFAULT 'per_booking';

ALTER TABLE public.charge_catalog
  DROP CONSTRAINT IF EXISTS charge_catalog_application_mode_chk;
ALTER TABLE public.charge_catalog
  ADD CONSTRAINT charge_catalog_application_mode_chk
  CHECK (application_mode IN ('per_room','per_booking'));

UPDATE public.charge_catalog SET application_mode = 'per_room'
 WHERE key IN ('early_check_in','late_check_out','extra_bed','extra_adult','extra_pet','cleaning_fee','extra_person');
