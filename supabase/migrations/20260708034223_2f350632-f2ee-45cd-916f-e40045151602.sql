-- Housekeeping task origin tracking (auto_checkout | auto_night_audit | manual)
ALTER TABLE public.housekeeping_tasks
  ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'auto_night_audit',
  ADD COLUMN IF NOT EXISTS manual_reason text NULL;

-- Constrain to the known vocabulary.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'housekeeping_tasks_origin_chk') THEN
    ALTER TABLE public.housekeeping_tasks
      ADD CONSTRAINT housekeeping_tasks_origin_chk
      CHECK (origin IN ('auto_checkout','auto_night_audit','manual'));
  END IF;
END$$;

-- Backfill existing rows so historic reporting stays honest.
UPDATE public.housekeeping_tasks
SET origin = CASE
  WHEN type = 'checkout_clean' THEN 'auto_checkout'
  ELSE 'auto_night_audit'
END
WHERE origin = 'auto_night_audit' AND created_at < now();