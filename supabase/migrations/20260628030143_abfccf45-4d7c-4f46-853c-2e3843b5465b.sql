DROP POLICY IF EXISTS "NA sessions: staff insert" ON public.night_audit_sessions;
DROP POLICY IF EXISTS "NA sessions: staff update" ON public.night_audit_sessions;

CREATE POLICY "NA sessions: ops insert"
  ON public.night_audit_sessions FOR INSERT
  TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(),'admin')
    OR public.has_role(auth.uid(),'owner')
    OR public.has_role(auth.uid(),'staff')
    OR public.has_role(auth.uid(),'reception')
  );

CREATE POLICY "NA sessions: ops update"
  ON public.night_audit_sessions FOR UPDATE
  TO authenticated
  USING (
    public.has_role(auth.uid(),'admin')
    OR public.has_role(auth.uid(),'owner')
    OR public.has_role(auth.uid(),'staff')
    OR public.has_role(auth.uid(),'reception')
  )
  WITH CHECK (
    public.has_role(auth.uid(),'admin')
    OR public.has_role(auth.uid(),'owner')
    OR public.has_role(auth.uid(),'staff')
    OR public.has_role(auth.uid(),'reception')
  );

DROP POLICY IF EXISTS "Ops can advance business date" ON public.app_settings;

CREATE POLICY "Ops can advance business date"
  ON public.app_settings FOR INSERT
  TO authenticated
  WITH CHECK (
    key = 'business_date'
    AND (
      public.has_role(auth.uid(),'admin')
      OR public.has_role(auth.uid(),'owner')
      OR public.has_role(auth.uid(),'staff')
      OR public.has_role(auth.uid(),'reception')
    )
  );

CREATE POLICY "Ops can update business date"
  ON public.app_settings FOR UPDATE
  TO authenticated
  USING (
    key = 'business_date'
    AND (
      public.has_role(auth.uid(),'admin')
      OR public.has_role(auth.uid(),'owner')
      OR public.has_role(auth.uid(),'staff')
      OR public.has_role(auth.uid(),'reception')
    )
  )
  WITH CHECK (
    key = 'business_date'
    AND (
      public.has_role(auth.uid(),'admin')
      OR public.has_role(auth.uid(),'owner')
      OR public.has_role(auth.uid(),'staff')
      OR public.has_role(auth.uid(),'reception')
    )
  );