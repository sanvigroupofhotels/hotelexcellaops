-- Storage RLS for cash-tx-attachments (Sprint 4 · UAT-031)

CREATE POLICY "cash_tx_attach_select"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'cash-tx-attachments');

CREATE POLICY "cash_tx_attach_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'cash-tx-attachments' AND auth.uid() IS NOT NULL);

CREATE POLICY "cash_tx_attach_update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'cash-tx-attachments'
    AND (
      owner = auth.uid()
      OR public.has_role(auth.uid(), 'admin')
      OR public.has_role(auth.uid(), 'owner')
    )
  );

CREATE POLICY "cash_tx_attach_delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'cash-tx-attachments'
    AND (
      owner = auth.uid()
      OR public.has_role(auth.uid(), 'admin')
      OR public.has_role(auth.uid(), 'owner')
    )
  );