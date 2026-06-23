-- Phase 3: extend activity_log with source + property_id and tighten RLS

ALTER TABLE public.activity_log
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS property_id uuid NULL;

ALTER TABLE public.activity_log
  DROP CONSTRAINT IF EXISTS activity_log_source_check;
ALTER TABLE public.activity_log
  ADD CONSTRAINT activity_log_source_check
  CHECK (source IN ('manual','house_view','guest_portal','ota','night_audit','system','api'));

CREATE INDEX IF NOT EXISTS activity_log_source_idx ON public.activity_log (source);
CREATE INDEX IF NOT EXISTS activity_log_property_idx ON public.activity_log (property_id);

-- Tighten RLS: staff sees only own; owner/admin see everything
DROP POLICY IF EXISTS "activity_log_select_own_or_admin" ON public.activity_log;
DROP POLICY IF EXISTS "activity_log_select" ON public.activity_log;

CREATE POLICY "activity_log_select"
  ON public.activity_log FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'owner')
    OR actor_id = auth.uid()
  );

-- Extend log_activity() with source + property_id
CREATE OR REPLACE FUNCTION public.log_activity(
  p_page text,
  p_action text,
  p_entity_type text DEFAULT NULL,
  p_entity_id uuid DEFAULT NULL,
  p_entity_reference text DEFAULT NULL,
  p_summary text DEFAULT NULL,
  p_before jsonb DEFAULT NULL,
  p_after jsonb DEFAULT NULL,
  p_metadata jsonb DEFAULT NULL,
  p_source text DEFAULT 'manual',
  p_property_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  a record;
  v_id uuid;
  v_source text := COALESCE(p_source, 'manual');
BEGIN
  IF v_source NOT IN ('manual','house_view','guest_portal','ota','night_audit','system','api') THEN
    v_source := 'manual';
  END IF;
  SELECT * INTO a FROM public.current_actor();
  INSERT INTO public.activity_log(
    actor_id, actor_name, actor_role,
    page, action,
    entity_type, entity_id, entity_reference,
    summary, before_state, after_state, metadata,
    source, property_id
  ) VALUES (
    a.uid, a.display_name, a.role,
    p_page, p_action,
    p_entity_type, p_entity_id, p_entity_reference,
    p_summary, p_before, p_after, p_metadata,
    v_source, p_property_id
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END
$function$;