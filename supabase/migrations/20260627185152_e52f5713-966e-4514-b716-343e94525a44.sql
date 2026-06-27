-- Allow staff to operate Night Audit sessions (start/update), in addition to admin/owner.
DROP POLICY IF EXISTS "NA sessions: admin/owner insert" ON public.night_audit_sessions;
DROP POLICY IF EXISTS "NA sessions: admin/owner update" ON public.night_audit_sessions;

CREATE POLICY "NA sessions: staff insert"
  ON public.night_audit_sessions FOR INSERT
  TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(),'admin')
    OR public.has_role(auth.uid(),'owner')
    OR public.has_role(auth.uid(),'staff')
  );

CREATE POLICY "NA sessions: staff update"
  ON public.night_audit_sessions FOR UPDATE
  TO authenticated
  USING (
    public.has_role(auth.uid(),'admin')
    OR public.has_role(auth.uid(),'owner')
    OR public.has_role(auth.uid(),'staff')
  )
  WITH CHECK (
    public.has_role(auth.uid(),'admin')
    OR public.has_role(auth.uid(),'owner')
    OR public.has_role(auth.uid(),'staff')
  );