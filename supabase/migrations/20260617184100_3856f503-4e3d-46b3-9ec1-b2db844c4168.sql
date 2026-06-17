
-- 1) Booking cancel/delete → expire guest documents (cron job purges files & rows)
CREATE OR REPLACE FUNCTION public.expire_guest_documents_for_booking(p_booking_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.guest_documents
    SET expires_at = now()
    WHERE booking_id = p_booking_id;
$$;

CREATE OR REPLACE FUNCTION public.bookings_expire_docs_on_cancel()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.expire_guest_documents_for_booking(OLD.id);
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.status::text = 'Cancelled' AND OLD.status::text IS DISTINCT FROM 'Cancelled' THEN
    PERFORM public.expire_guest_documents_for_booking(NEW.id);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_bookings_expire_docs ON public.bookings;
CREATE TRIGGER trg_bookings_expire_docs
  AFTER UPDATE OR DELETE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.bookings_expire_docs_on_cancel();

-- 2) Payment OCR audit columns
ALTER TABLE public.booking_payments
  ADD COLUMN IF NOT EXISTS ocr_image_path text,
  ADD COLUMN IF NOT EXISTS ocr_extracted_text text,
  ADD COLUMN IF NOT EXISTS ocr_data jsonb,
  ADD COLUMN IF NOT EXISTS ocr_corrections jsonb;

-- 3) Storage policies for payment-screenshots bucket
CREATE POLICY "payment_shots_staff_read"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'payment-screenshots');

CREATE POLICY "payment_shots_staff_write"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'payment-screenshots');

CREATE POLICY "payment_shots_staff_update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'payment-screenshots');

CREATE POLICY "payment_shots_admin_delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'payment-screenshots' AND public.is_admin());
