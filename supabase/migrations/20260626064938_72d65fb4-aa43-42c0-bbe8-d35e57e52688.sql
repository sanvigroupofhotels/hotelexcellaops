
CREATE OR REPLACE FUNCTION public.notify_lead_abandoned()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_guest_count int;
  v_amount numeric;
  v_body text;
  v_target_entity_type text;
  v_target_entity_id uuid;
BEGIN
  IF TG_OP <> 'UPDATE' THEN RETURN NEW; END IF;
  IF NEW.status::text = 'Abandoned'
     AND OLD.status::text IS DISTINCT FROM NEW.status::text THEN
    v_guest_count := COALESCE(NEW.adults, 0) + COALESCE(NEW.children, 0);
    IF v_guest_count <= 0 THEN v_guest_count := COALESCE(NEW.rooms, 0); END IF;
    v_amount := COALESCE(NEW.estimated_total, 0);
    v_body := CONCAT(
      'Guest: ', COALESCE(NEW.guest_name, '—'), E'\n',
      'Phone: ', COALESCE(NEW.phone, '—'), E'\n',
      'Guests: ', COALESCE(v_guest_count::text, '—'), E'\n',
      'Check-In: ', COALESCE(NEW.check_in::text, '—'), E'\n',
      'Check-Out: ', COALESCE(NEW.check_out::text, '—'), E'\n',
      'Booking Value: ₹', trim(to_char(v_amount, 'FM99,99,99,990'))
    );

    IF NEW.booking_id IS NOT NULL THEN
      v_target_entity_type := 'booking';
      v_target_entity_id := NEW.booking_id;
    ELSIF NEW.customer_id IS NOT NULL THEN
      v_target_entity_type := 'customer';
      v_target_entity_id := NEW.customer_id;
    ELSE
      v_target_entity_type := 'lead';
      v_target_entity_id := NEW.id;
    END IF;

    INSERT INTO public.notifications (
      type, title, body, entity_type, entity_id, entity_reference,
      priority, status, audience_role, metadata
    ) VALUES (
      'lead_abandoned',
      'Lead Abandoned',
      v_body,
      v_target_entity_type,
      v_target_entity_id,
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
        'source_channel', NEW.source_channel,
        'lead_id', NEW.id,
        'draft_booking_id', NEW.booking_id,
        'customer_id', NEW.customer_id
      )
    );
  END IF;
  RETURN NEW;
END
$function$;
