CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  entity_type text,
  entity_id uuid,
  entity_reference text,
  priority text NOT NULL DEFAULT 'normal',
  status text NOT NULL DEFAULT 'unread',
  audience_role text,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notifications_priority_check CHECK (priority IN ('low','normal','high','urgent')),
  CONSTRAINT notifications_status_check CHECK (status IN ('unread','read','dismissed'))
);

GRANT SELECT, UPDATE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view operational notifications"
ON public.notifications
FOR SELECT
TO authenticated
USING (user_id IS NULL OR user_id = auth.uid());

CREATE POLICY "Users can update their own notification state"
ON public.notifications
FOR UPDATE
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

CREATE INDEX notifications_created_at_idx ON public.notifications (created_at DESC);
CREATE INDEX notifications_entity_idx ON public.notifications (entity_type, entity_id);
CREATE INDEX notifications_unread_idx ON public.notifications (status, created_at DESC) WHERE status = 'unread';

CREATE TRIGGER notifications_set_updated_at
BEFORE UPDATE ON public.notifications
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.notify_lead_abandoned()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_guest_count int;
  v_amount numeric;
  v_body text;
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  IF NEW.status::text = 'Abandoned'
     AND OLD.status::text IS DISTINCT FROM NEW.status::text THEN
    v_guest_count := COALESCE(NEW.adults, 0) + COALESCE(NEW.children, 0);
    IF v_guest_count <= 0 THEN
      v_guest_count := COALESCE(NEW.rooms, 0);
    END IF;
    v_amount := COALESCE(NEW.estimated_total, 0);
    v_body := CONCAT(
      'Guest: ', COALESCE(NEW.guest_name, '—'), E'\n',
      'Phone: ', COALESCE(NEW.phone, '—'), E'\n',
      'Guests: ', COALESCE(v_guest_count::text, '—'), E'\n',
      'Check-In: ', COALESCE(NEW.check_in::text, '—'), E'\n',
      'Check-Out: ', COALESCE(NEW.check_out::text, '—'), E'\n',
      'Booking Value: ₹', trim(to_char(v_amount, 'FM99,99,99,990'))
    );

    INSERT INTO public.notifications (
      type, title, body, entity_type, entity_id, entity_reference,
      priority, status, audience_role, metadata
    ) VALUES (
      'lead_abandoned',
      'Lead Abandoned',
      v_body,
      'lead',
      NEW.id,
      NEW.phone,
      'high',
      'unread',
      'operations',
      jsonb_build_object(
        'guest_name', NEW.guest_name,
        'phone', NEW.phone,
        'guests', v_guest_count,
        'check_in', NEW.check_in,
        'check_out', NEW.check_out,
        'booking_value', v_amount,
        'source_channel', NEW.source_channel
      )
    );
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER leads_notify_abandoned
AFTER UPDATE ON public.leads
FOR EACH ROW EXECUTE FUNCTION public.notify_lead_abandoned();