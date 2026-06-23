-- Phase 3 Shipment 2: correlation_id + action vocabulary expansion

ALTER TABLE public.activity_log
  ADD COLUMN IF NOT EXISTS correlation_id uuid NULL;

CREATE INDEX IF NOT EXISTS activity_log_correlation_id_idx
  ON public.activity_log(correlation_id)
  WHERE correlation_id IS NOT NULL;

-- Replace older overloads of log_activity with a single canonical signature
-- that accepts source, property_id, and correlation_id.
DROP FUNCTION IF EXISTS public.log_activity(text, text, text, uuid, text, text, jsonb, jsonb, jsonb);
DROP FUNCTION IF EXISTS public.log_activity(text, text, text, uuid, text, text, jsonb, jsonb, jsonb, text, uuid);

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
  p_property_id uuid DEFAULT NULL,
  p_correlation_id uuid DEFAULT NULL
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
    source, property_id, correlation_id
  ) VALUES (
    a.uid, a.display_name, a.role,
    p_page, p_action,
    p_entity_type, p_entity_id, p_entity_reference,
    p_summary, p_before, p_after, p_metadata,
    v_source, p_property_id, p_correlation_id
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END
$function$;

GRANT EXECUTE ON FUNCTION public.log_activity(text, text, text, uuid, text, text, jsonb, jsonb, jsonb, text, uuid, uuid) TO authenticated, service_role;
