
CREATE TABLE IF NOT EXISTS public.activity_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_id uuid NULL,
  actor_name text NULL,
  actor_role text NULL,
  page text NOT NULL,
  action text NOT NULL,
  entity_type text NULL,
  entity_id uuid NULL,
  entity_reference text NULL,
  summary text NULL,
  before_state jsonb NULL,
  after_state jsonb NULL,
  metadata jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS activity_log_occurred_idx ON public.activity_log (occurred_at DESC);
CREATE INDEX IF NOT EXISTS activity_log_actor_idx ON public.activity_log (actor_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS activity_log_entity_idx ON public.activity_log (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS activity_log_page_action_idx ON public.activity_log (page, action);

GRANT SELECT ON public.activity_log TO authenticated;
GRANT ALL ON public.activity_log TO service_role;

ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners and admins view all activity"
  ON public.activity_log FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'owner')
    OR actor_id = auth.uid()
  );

-- Secure logging helper. Resolves actor from auth.uid() so the app cannot spoof identity.
CREATE OR REPLACE FUNCTION public.log_activity(
  p_page text,
  p_action text,
  p_entity_type text DEFAULT NULL,
  p_entity_id uuid DEFAULT NULL,
  p_entity_reference text DEFAULT NULL,
  p_summary text DEFAULT NULL,
  p_before jsonb DEFAULT NULL,
  p_after jsonb DEFAULT NULL,
  p_metadata jsonb DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a record;
  v_id uuid;
BEGIN
  SELECT * INTO a FROM public.current_actor();
  INSERT INTO public.activity_log(
    actor_id, actor_name, actor_role,
    page, action,
    entity_type, entity_id, entity_reference,
    summary, before_state, after_state, metadata
  ) VALUES (
    a.uid, a.display_name, a.role,
    p_page, p_action,
    p_entity_type, p_entity_id, p_entity_reference,
    p_summary, p_before, p_after, p_metadata
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END
$$;

GRANT EXECUTE ON FUNCTION public.log_activity(text, text, text, uuid, text, text, jsonb, jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.log_activity(text, text, text, uuid, text, text, jsonb, jsonb, jsonb) TO service_role;
