-- Replace legacy role checks (staff/reception) with the active fo_staff role
-- on Night Audit surfaces. Admin/Owner/FO Staff can operate Night Audit;
-- Housekeeping cannot. Same allow-list is applied to app_settings business_date.

DROP POLICY IF EXISTS "NA sessions: ops insert" ON public.night_audit_sessions;
DROP POLICY IF EXISTS "NA sessions: ops update" ON public.night_audit_sessions;
DROP POLICY IF EXISTS "NA sessions: staff insert" ON public.night_audit_sessions;
DROP POLICY IF EXISTS "NA sessions: staff update" ON public.night_audit_sessions;

CREATE POLICY "NA sessions: ops insert"
  ON public.night_audit_sessions FOR INSERT
  TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(),'admin')
    OR public.has_role(auth.uid(),'owner')
    OR public.has_role(auth.uid(),'fo_staff')
  );

CREATE POLICY "NA sessions: ops update"
  ON public.night_audit_sessions FOR UPDATE
  TO authenticated
  USING (
    public.has_role(auth.uid(),'admin')
    OR public.has_role(auth.uid(),'owner')
    OR public.has_role(auth.uid(),'fo_staff')
  )
  WITH CHECK (
    public.has_role(auth.uid(),'admin')
    OR public.has_role(auth.uid(),'owner')
    OR public.has_role(auth.uid(),'fo_staff')
  );

-- Also fix the corresponding decisions table if it has legacy checks.
DROP POLICY IF EXISTS "NA decisions: ops insert" ON public.night_audit_decisions;

CREATE POLICY "NA decisions: ops insert"
  ON public.night_audit_decisions FOR INSERT
  TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(),'admin')
    OR public.has_role(auth.uid(),'owner')
    OR public.has_role(auth.uid(),'fo_staff')
  );

-- Business Date advance/update: same allow-list.
DROP POLICY IF EXISTS "Ops can advance business date" ON public.app_settings;
DROP POLICY IF EXISTS "Ops can update business date" ON public.app_settings;

CREATE POLICY "Ops can advance business date"
  ON public.app_settings FOR INSERT
  TO authenticated
  WITH CHECK (
    key = 'business_date'
    AND (
      public.has_role(auth.uid(),'admin')
      OR public.has_role(auth.uid(),'owner')
      OR public.has_role(auth.uid(),'fo_staff')
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
      OR public.has_role(auth.uid(),'fo_staff')
    )
  )
  WITH CHECK (
    key = 'business_date'
    AND (
      public.has_role(auth.uid(),'admin')
      OR public.has_role(auth.uid(),'owner')
      OR public.has_role(auth.uid(),'fo_staff')
    )
  );
