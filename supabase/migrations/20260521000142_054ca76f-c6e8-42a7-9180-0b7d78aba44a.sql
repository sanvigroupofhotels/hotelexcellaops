
ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS early_check_in_slot text,
  ADD COLUMN IF NOT EXISTS late_check_out_slot text,
  ADD COLUMN IF NOT EXISTS extra_adults integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS drivers integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS breakfast_included boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS extra_breakfast_guests integer NOT NULL DEFAULT 0;

ALTER TABLE public.quotes
  ADD CONSTRAINT quotes_early_slot_chk
  CHECK (early_check_in_slot IS NULL OR early_check_in_slot IN ('10-13','8-10','6-8','before-6'));

ALTER TABLE public.quotes
  ADD CONSTRAINT quotes_late_slot_chk
  CHECK (late_check_out_slot IS NULL OR late_check_out_slot IN ('upto-2pm','2-4pm','after-4pm'));

ALTER TABLE public.quotes
  ADD CONSTRAINT quotes_counts_nonneg_chk
  CHECK (extra_adults >= 0 AND drivers >= 0 AND extra_breakfast_guests >= 0);

ALTER TABLE public.quotes
  ADD CONSTRAINT quotes_breakfast_consistency_chk
  CHECK (
    breakfast_included = true AND extra_breakfast_guests = 0
    OR breakfast_included = false
  );
