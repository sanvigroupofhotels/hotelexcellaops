
-- Staff documents table
CREATE TABLE public.staff_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  doc_type text NOT NULL,
  file_path text NOT NULL,
  file_name text NOT NULL,
  mime_type text,
  file_size_bytes bigint,
  uploaded_by uuid REFERENCES auth.users(id),
  uploaded_by_name text,
  notes text,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX staff_documents_staff_idx ON public.staff_documents(staff_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff_documents TO authenticated;
GRANT ALL ON public.staff_documents TO service_role;

ALTER TABLE public.staff_documents ENABLE ROW LEVEL SECURITY;

-- Owner/Admin only access
CREATE POLICY "Admins view staff documents"
  ON public.staff_documents FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'owner'));

CREATE POLICY "Admins insert staff documents"
  ON public.staff_documents FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'owner'));

CREATE POLICY "Admins update staff documents"
  ON public.staff_documents FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'owner'));

CREATE POLICY "Admins delete staff documents"
  ON public.staff_documents FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'owner'));

CREATE TRIGGER staff_documents_set_updated_at
  BEFORE UPDATE ON public.staff_documents
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Cascade delete storage objects when staff_documents row is deleted
CREATE OR REPLACE FUNCTION public.staff_documents_delete_storage()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM storage.objects WHERE bucket_id = 'staff-documents' AND name = OLD.file_path;
  RETURN OLD;
END $$;

CREATE TRIGGER staff_documents_delete_storage_trg
  AFTER DELETE ON public.staff_documents
  FOR EACH ROW EXECUTE FUNCTION public.staff_documents_delete_storage();

-- Storage policies on storage.objects for staff-documents bucket (Owner/Admin only)
CREATE POLICY "Admins read staff-documents storage"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'staff-documents'
    AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'owner')));

CREATE POLICY "Admins upload staff-documents storage"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'staff-documents'
    AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'owner')));

CREATE POLICY "Admins delete staff-documents storage"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'staff-documents'
    AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'owner')));
