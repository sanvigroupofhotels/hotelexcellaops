
-- 1. Add customer_id, make booking_id nullable, and require at least one link.
ALTER TABLE public.guest_documents
  ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL;

ALTER TABLE public.guest_documents ALTER COLUMN booking_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS guest_documents_customer_idx
  ON public.guest_documents(customer_id) WHERE deleted_at IS NULL;

-- Enforce: a document must belong to a booking, a customer, or both.
CREATE OR REPLACE FUNCTION public.guest_documents_require_owner()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.booking_id IS NULL AND NEW.customer_id IS NULL THEN
    RAISE EXCEPTION 'guest_documents must reference a booking or a customer';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_guest_documents_require_owner ON public.guest_documents;
CREATE TRIGGER trg_guest_documents_require_owner
  BEFORE INSERT OR UPDATE ON public.guest_documents
  FOR EACH ROW EXECUTE FUNCTION public.guest_documents_require_owner();

-- 2. Auto-link customer_id from the booking when missing.
CREATE OR REPLACE FUNCTION public.guest_documents_auto_link_customer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.customer_id IS NULL AND NEW.booking_id IS NOT NULL THEN
    SELECT customer_id INTO NEW.customer_id
      FROM public.bookings WHERE id = NEW.booking_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_guest_documents_auto_link_customer ON public.guest_documents;
CREATE TRIGGER trg_guest_documents_auto_link_customer
  BEFORE INSERT ON public.guest_documents
  FOR EACH ROW EXECUTE FUNCTION public.guest_documents_auto_link_customer();

-- 3. Backfill customer_id for existing rows.
UPDATE public.guest_documents gd
   SET customer_id = b.customer_id
  FROM public.bookings b
 WHERE gd.booking_id = b.id
   AND gd.customer_id IS NULL
   AND b.customer_id IS NOT NULL;

-- 4. On booking check-out: ensure docs are linked to customer and extend retention.
CREATE OR REPLACE FUNCTION public.bookings_finalize_guest_docs_on_checkout()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status::text = 'Checked-Out'
     AND (TG_OP = 'INSERT' OR OLD.status::text IS DISTINCT FROM NEW.status::text)
     AND NEW.customer_id IS NOT NULL THEN
    UPDATE public.guest_documents
       SET customer_id = COALESCE(customer_id, NEW.customer_id),
           expires_at  = GREATEST(expires_at, now() + interval '5 years')
     WHERE booking_id = NEW.id
       AND deleted_at IS NULL;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_bookings_finalize_guest_docs_on_checkout ON public.bookings;
CREATE TRIGGER trg_bookings_finalize_guest_docs_on_checkout
  AFTER INSERT OR UPDATE OF status ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.bookings_finalize_guest_docs_on_checkout();

-- 5. Replace the cancel-expire trigger so it only short-expires docs that are
--    NOT yet linked to a customer (customer-owned docs persist across stays).
CREATE OR REPLACE FUNCTION public.expire_guest_documents_for_booking(p_booking_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.guest_documents
    SET expires_at = now()
    WHERE booking_id = p_booking_id
      AND customer_id IS NULL;
$$;

-- 6. Email sync — latest booking email wins on the customer record.
CREATE OR REPLACE FUNCTION public.bookings_sync_email_to_customer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_email text := NULLIF(lower(trim(NEW.email)), '');
BEGIN
  IF NEW.customer_id IS NULL OR v_new_email IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND lower(trim(COALESCE(OLD.email,''))) = v_new_email THEN
    RETURN NEW;
  END IF;
  UPDATE public.customers
    SET email = NEW.email
    WHERE id = NEW.customer_id
      AND COALESCE(lower(trim(email)), '') IS DISTINCT FROM v_new_email;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_bookings_sync_email_to_customer ON public.bookings;
CREATE TRIGGER trg_bookings_sync_email_to_customer
  AFTER INSERT OR UPDATE OF email, customer_id ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.bookings_sync_email_to_customer();
