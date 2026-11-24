CREATE TABLE IF NOT EXISTS public.housekeeping_room_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  room_id uuid NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  assigned_by uuid DEFAULT auth.uid(),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, room_id)
);

CREATE INDEX IF NOT EXISTS housekeeping_room_assignments_room_idx
  ON public.housekeeping_room_assignments (room_id);
CREATE INDEX IF NOT EXISTS housekeeping_room_assignments_user_idx
  ON public.housekeeping_room_assignments (user_id);

ALTER TABLE public.housekeeping_room_assignments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.housekeeping_room_assignments FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.housekeeping_room_assignments TO authenticated;
GRANT ALL ON public.housekeeping_room_assignments TO service_role;

DROP POLICY IF EXISTS hk_room_assignments_read ON public.housekeeping_room_assignments;
CREATE POLICY hk_room_assignments_read ON public.housekeeping_room_assignments
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'owner')
    OR public.has_role(auth.uid(), 'fo_staff')
  );

DROP POLICY IF EXISTS hk_room_assignments_manage ON public.housekeeping_room_assignments;
CREATE POLICY hk_room_assignments_manage ON public.housekeeping_room_assignments
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'owner'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'owner'));

-- Housekeeping accounts only read and change rooms assigned to their own user.
-- Front Office and administrators retain their existing broader operational access.
DROP POLICY IF EXISTS hk_assigned_rooms_only ON public.rooms;
CREATE POLICY hk_assigned_rooms_only ON public.rooms AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'owner')
    OR public.has_role(auth.uid(), 'fo_staff')
    OR NOT public.has_role(auth.uid(), 'housekeeping')
    OR EXISTS (
      SELECT 1 FROM public.housekeeping_room_assignments a
      WHERE a.user_id = auth.uid() AND a.room_id = rooms.id
    )
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'owner')
    OR public.has_role(auth.uid(), 'fo_staff')
    OR NOT public.has_role(auth.uid(), 'housekeeping')
    OR EXISTS (
      SELECT 1 FROM public.housekeeping_room_assignments a
      WHERE a.user_id = auth.uid() AND a.room_id = rooms.id
    )
  );

DROP POLICY IF EXISTS hk_assigned_tasks_only ON public.housekeeping_tasks;
CREATE POLICY hk_assigned_tasks_only ON public.housekeeping_tasks AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'owner')
    OR public.has_role(auth.uid(), 'fo_staff')
    OR NOT public.has_role(auth.uid(), 'housekeeping')
    OR EXISTS (
      SELECT 1 FROM public.housekeeping_room_assignments a
      WHERE a.user_id = auth.uid() AND a.room_id = housekeeping_tasks.room_id
    )
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'owner')
    OR public.has_role(auth.uid(), 'fo_staff')
    OR NOT public.has_role(auth.uid(), 'housekeeping')
    OR EXISTS (
      SELECT 1 FROM public.housekeeping_room_assignments a
      WHERE a.user_id = auth.uid() AND a.room_id = housekeeping_tasks.room_id
    )
  );

DROP POLICY IF EXISTS hk_assigned_exceptions_only ON public.housekeeping_room_exceptions;
CREATE POLICY hk_assigned_exceptions_only ON public.housekeeping_room_exceptions AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'owner')
    OR public.has_role(auth.uid(), 'fo_staff')
    OR NOT public.has_role(auth.uid(), 'housekeeping')
    OR EXISTS (
      SELECT 1 FROM public.housekeeping_room_assignments a
      WHERE a.user_id = auth.uid() AND a.room_id = housekeeping_room_exceptions.room_id
    )
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'owner')
    OR public.has_role(auth.uid(), 'fo_staff')
    OR NOT public.has_role(auth.uid(), 'housekeeping')
    OR EXISTS (
      SELECT 1 FROM public.housekeeping_room_assignments a
      WHERE a.user_id = auth.uid() AND a.room_id = housekeeping_room_exceptions.room_id
    )
  );

DROP POLICY IF EXISTS hk_assigned_laundry_only ON public.laundry_queue;
CREATE POLICY hk_assigned_laundry_only ON public.laundry_queue AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'owner')
    OR public.has_role(auth.uid(), 'fo_staff')
    OR NOT public.has_role(auth.uid(), 'housekeeping')
    OR EXISTS (
      SELECT 1 FROM public.housekeeping_room_assignments a
      WHERE a.user_id = auth.uid() AND a.room_id = laundry_queue.room_id
    )
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'owner')
    OR public.has_role(auth.uid(), 'fo_staff')
    OR NOT public.has_role(auth.uid(), 'housekeeping')
    OR EXISTS (
      SELECT 1 FROM public.housekeeping_room_assignments a
      WHERE a.user_id = auth.uid() AND a.room_id = laundry_queue.room_id
    )
  );
