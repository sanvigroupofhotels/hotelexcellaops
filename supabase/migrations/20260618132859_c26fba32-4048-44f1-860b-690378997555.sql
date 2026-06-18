-- Night audit idempotency: only one successful run per previous_business_date.
-- Drop any duplicates first (keep earliest).
DELETE FROM public.night_audit_runs a
USING public.night_audit_runs b
WHERE a.previous_business_date = b.previous_business_date
  AND a.created_at > b.created_at;

ALTER TABLE public.night_audit_runs
  ADD CONSTRAINT night_audit_runs_prev_date_unique
  UNIQUE (previous_business_date);