
-- 1) Make expires_at nullable so customer-owned docs can defer entirely to
--    the retention configuration in app_settings (single source of truth).
ALTER TABLE public.guest_documents
  ALTER COLUMN expires_at DROP NOT NULL,
  ALTER COLUMN expires_at DROP DEFAULT;

-- Booking-uploaded docs still get the default 60-day soft expiry; we keep
-- the default behaviour by re-applying it as a column default for inserts
-- that don't specify it. We just lifted the NOT NULL so customer-owned
-- rows can carry NULL.
ALTER TABLE public.guest_documents
  ALTER COLUMN expires_at SET DEFAULT (now() + interval '60 days');

-- 2) Replace the checkout finalizer: stop hard-coding +5 years. Customer-
--    owned docs should retain only as long as the retention setting allows.
--    Setting expires_at = NULL means "no early-expiry"; the cleanup job
--    will purge it solely based on uploaded_at vs documents_retention.
CREATE OR REPLACE FUNCTION public.bookings_finalize_guest_docs_on_checkout()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status::text = 'Checked-Out'
     AND (TG_OP = 'INSERT' OR OLD.status::text IS DISTINCT FROM NEW.status::text)
     AND NEW.customer_id IS NOT NULL THEN
    UPDATE public.guest_documents
       SET customer_id = COALESCE(customer_id, NEW.customer_id),
           expires_at  = NULL
     WHERE booking_id = NEW.id
       AND deleted_at IS NULL;
  END IF;
  RETURN NEW;
END $function$;

-- 3) Add a `source` column so the Customer Documents card and audits can
--    show where each upload came from (Reception, Guest Portal, Booking
--    Engine, OTA, Walk-in, etc). Nullable for legacy rows.
ALTER TABLE public.guest_documents
  ADD COLUMN IF NOT EXISTS source text;
