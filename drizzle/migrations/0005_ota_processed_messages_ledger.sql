CREATE TABLE IF NOT EXISTS public.integration_processed_messages (
  integration_id uuid NOT NULL,
  message_id text NOT NULL,
  external_ref text,
  outcome text,
  processed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (integration_id, message_id)
);
GRANT SELECT, DELETE ON public.integration_processed_messages TO authenticated;
GRANT ALL ON public.integration_processed_messages TO service_role;
ALTER TABLE public.integration_processed_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY ipm_select ON public.integration_processed_messages FOR SELECT TO authenticated USING (true);
CREATE POLICY ipm_delete ON public.integration_processed_messages FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'owner'));