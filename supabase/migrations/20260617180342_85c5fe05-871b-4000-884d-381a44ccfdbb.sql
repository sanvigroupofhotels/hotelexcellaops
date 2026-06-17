
CREATE TABLE public.guest_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  user_id uuid NOT NULL DEFAULT auth.uid(),
  doc_type text NOT NULL,
  front_path text,
  back_path text,
  selfie_path text,
  notes text,
  uploaded_by uuid,
  uploaded_by_name text,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  deleted_by uuid,
  deleted_by_name text,
  deleted_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '60 days'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX guest_documents_booking_idx ON public.guest_documents(booking_id) WHERE deleted_at IS NULL;
CREATE INDEX guest_documents_expires_idx ON public.guest_documents(expires_at) WHERE deleted_at IS NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.guest_documents TO authenticated;
GRANT ALL ON public.guest_documents TO service_role;

ALTER TABLE public.guest_documents ENABLE ROW LEVEL SECURITY;

-- Any authenticated user with a role can view/manage; admins can hard-delete.
CREATE POLICY "Authenticated can view guest documents"
  ON public.guest_documents FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Authenticated can insert guest documents"
  ON public.guest_documents FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated can update guest documents"
  ON public.guest_documents FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Admins can hard delete guest documents"
  ON public.guest_documents FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_guest_documents_updated_at
  BEFORE UPDATE ON public.guest_documents
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Storage policies on guest-documents bucket
CREATE POLICY "Auth can read guest doc files"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'guest-documents');

CREATE POLICY "Auth can upload guest doc files"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'guest-documents');

CREATE POLICY "Auth can update guest doc files"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'guest-documents');

CREATE POLICY "Admins can delete guest doc files"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'guest-documents' AND public.has_role(auth.uid(), 'admin'));

-- Cleanup helper: hard-deletes guest_documents rows past retention.
-- Storage file purge handled by the public cron route which iterates rows before calling this.
CREATE OR REPLACE FUNCTION public.cleanup_expired_guest_documents()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE n integer;
BEGIN
  WITH d AS (
    DELETE FROM public.guest_documents WHERE expires_at < now() RETURNING 1
  ) SELECT count(*) INTO n FROM d;
  RETURN COALESCE(n, 0);
END $$;
