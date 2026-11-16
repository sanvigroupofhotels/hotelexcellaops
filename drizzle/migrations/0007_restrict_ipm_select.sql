DROP POLICY IF EXISTS "ipm_select" ON public.integration_processed_messages;
CREATE POLICY "ipm_select" ON public.integration_processed_messages
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'owner'::app_role));