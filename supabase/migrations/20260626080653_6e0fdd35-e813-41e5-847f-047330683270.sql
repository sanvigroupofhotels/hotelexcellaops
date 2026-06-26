
-- Fix notification mark-read / dismiss: operational notifications (user_id IS NULL)
-- were unaffected by updates because the policy required user_id = auth.uid().
DROP POLICY IF EXISTS "Users can update their own notification state" ON public.notifications;
CREATE POLICY "Users can update notification state"
  ON public.notifications FOR UPDATE TO authenticated
  USING (user_id IS NULL OR user_id = auth.uid())
  WITH CHECK (user_id IS NULL OR user_id = auth.uid());

-- Backfill existing lead notifications so click-through resolves to the
-- linked booking (preferred) or customer instead of falling back to /follow-ups.
UPDATE public.notifications n
SET
  entity_type = CASE
    WHEN l.booking_id IS NOT NULL THEN 'booking'
    WHEN l.customer_id IS NOT NULL THEN 'customer'
    ELSE 'lead'
  END,
  entity_id = CASE
    WHEN l.booking_id IS NOT NULL THEN l.booking_id
    WHEN l.customer_id IS NOT NULL THEN l.customer_id
    ELSE n.entity_id
  END,
  metadata = COALESCE(n.metadata, '{}'::jsonb)
    || jsonb_build_object('lead_id', l.id, 'draft_booking_id', l.booking_id, 'customer_id', l.customer_id)
FROM public.leads l
WHERE n.entity_type = 'lead' AND n.entity_id = l.id;
