-- HEOS Core v1.1 Sprint 4 · UAT-031: Cash Transaction bill attachments

CREATE TABLE IF NOT EXISTS public.cash_tx_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tx_id UUID NOT NULL REFERENCES public.cash_transactions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  storage_path TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size INTEGER,
  original_filename TEXT,
  uploaded_by UUID,
  uploaded_by_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cash_tx_attachments_tx_idx ON public.cash_tx_attachments(tx_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.cash_tx_attachments TO authenticated;
GRANT ALL ON public.cash_tx_attachments TO service_role;

ALTER TABLE public.cash_tx_attachments ENABLE ROW LEVEL SECURITY;

-- Anyone signed in with cashbook access can view attachments on their tenant's cash txns.
-- Model mirrors cash_transactions policies (owner/team-scoped via user_id).
CREATE POLICY "attachments_select_own_tenant"
  ON public.cash_tx_attachments
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.cash_transactions t
      WHERE t.id = cash_tx_attachments.tx_id
        AND t.user_id = cash_tx_attachments.user_id
    )
  );

CREATE POLICY "attachments_insert_authenticated"
  ON public.cash_tx_attachments
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "attachments_delete_admin_owner_or_uploader"
  ON public.cash_tx_attachments
  FOR DELETE TO authenticated
  USING (
    uploaded_by = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'owner')
  );

CREATE POLICY "attachments_update_admin_owner_or_uploader"
  ON public.cash_tx_attachments
  FOR UPDATE TO authenticated
  USING (
    uploaded_by = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'owner')
  );

-- Extend cash_tx_activities to log attachment operations. `action` is a plain
-- TEXT column (no enum), so no ALTER TYPE needed — existing check trigger
-- accepts any string.

COMMENT ON TABLE public.cash_tx_attachments IS
  'Bill/receipt attachments for cash_transactions (UAT-031). FO staff must attach at least one when Cash Out amount > 300; owners/admins may bypass at the app layer.';