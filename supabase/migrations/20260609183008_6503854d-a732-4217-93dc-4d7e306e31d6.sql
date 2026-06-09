-- Booking payment audit history
CREATE TABLE public.booking_payment_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid,
  booking_id uuid NOT NULL,
  actor_id uuid,
  actor_name text,
  actor_role text,
  action text NOT NULL, -- 'created' | 'updated' | 'deleted'
  field text,
  old_value text,
  new_value text,
  summary text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.booking_payment_activities TO authenticated;
GRANT ALL ON public.booking_payment_activities TO service_role;

ALTER TABLE public.booking_payment_activities ENABLE ROW LEVEL SECURITY;

CREATE POLICY bpa_read_all ON public.booking_payment_activities FOR SELECT TO authenticated USING (true);
CREATE POLICY bpa_insert_system ON public.booking_payment_activities FOR INSERT TO authenticated WITH CHECK (true);

CREATE INDEX bpa_booking_idx ON public.booking_payment_activities (booking_id, created_at DESC);
CREATE INDEX bpa_payment_idx ON public.booking_payment_activities (payment_id, created_at DESC);

-- Audit trigger function
CREATE OR REPLACE FUNCTION public.booking_payments_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE a record;
BEGIN
  SELECT * INTO a FROM public.current_actor();
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.booking_payment_activities(payment_id, booking_id, actor_id, actor_name, actor_role, action, summary)
    VALUES (NEW.id, NEW.booking_id, a.uid, a.display_name, a.role, 'created',
      CONCAT('Created payment · ₹', NEW.amount::text, ' · ', NEW.payment_mode, ' · by ', NEW.collected_by));
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.amount IS DISTINCT FROM NEW.amount THEN
      INSERT INTO public.booking_payment_activities(payment_id, booking_id, actor_id, actor_name, actor_role, action, field, old_value, new_value, summary)
      VALUES (NEW.id, NEW.booking_id, a.uid, a.display_name, a.role, 'updated', 'Amount', OLD.amount::text, NEW.amount::text, 'Amount changed');
    END IF;
    IF OLD.payment_mode IS DISTINCT FROM NEW.payment_mode THEN
      INSERT INTO public.booking_payment_activities(payment_id, booking_id, actor_id, actor_name, actor_role, action, field, old_value, new_value, summary)
      VALUES (NEW.id, NEW.booking_id, a.uid, a.display_name, a.role, 'updated', 'Mode', OLD.payment_mode, NEW.payment_mode, 'Payment mode changed');
    END IF;
    IF OLD.collected_by IS DISTINCT FROM NEW.collected_by THEN
      INSERT INTO public.booking_payment_activities(payment_id, booking_id, actor_id, actor_name, actor_role, action, field, old_value, new_value, summary)
      VALUES (NEW.id, NEW.booking_id, a.uid, a.display_name, a.role, 'updated', 'Collected By', OLD.collected_by, NEW.collected_by, 'Collected By changed');
    END IF;
    IF OLD.occurred_at IS DISTINCT FROM NEW.occurred_at THEN
      INSERT INTO public.booking_payment_activities(payment_id, booking_id, actor_id, actor_name, actor_role, action, field, old_value, new_value, summary)
      VALUES (NEW.id, NEW.booking_id, a.uid, a.display_name, a.role, 'updated', 'Date', OLD.occurred_at::text, NEW.occurred_at::text, 'Date/Time changed');
    END IF;
    IF COALESCE(OLD.notes,'') IS DISTINCT FROM COALESCE(NEW.notes,'') THEN
      INSERT INTO public.booking_payment_activities(payment_id, booking_id, actor_id, actor_name, actor_role, action, field, old_value, new_value, summary)
      VALUES (NEW.id, NEW.booking_id, a.uid, a.display_name, a.role, 'updated', 'Notes', OLD.notes, NEW.notes, 'Notes changed');
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.booking_payment_activities(payment_id, booking_id, actor_id, actor_name, actor_role, action, summary)
    VALUES (OLD.id, OLD.booking_id, a.uid, a.display_name, a.role, 'deleted',
      CONCAT('Deleted payment · ₹', OLD.amount::text, ' · ', OLD.payment_mode, ' · by ', OLD.collected_by));
    RETURN OLD;
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS booking_payments_audit_trg ON public.booking_payments;
CREATE TRIGGER booking_payments_audit_trg
AFTER INSERT OR UPDATE OR DELETE ON public.booking_payments
FOR EACH ROW EXECUTE FUNCTION public.booking_payments_audit();
