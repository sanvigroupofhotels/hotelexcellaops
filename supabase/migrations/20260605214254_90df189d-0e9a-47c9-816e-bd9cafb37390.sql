
-- 1) Add 'owner' to app_role enum if missing
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'owner' AND enumtypid = 'public.app_role'::regtype) THEN
    ALTER TYPE public.app_role ADD VALUE 'owner';
  END IF;
END $$;

-- 2) Activity log table for cash transactions
CREATE TABLE IF NOT EXISTS public.cash_tx_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tx_id uuid NOT NULL,
  actor_id uuid,
  actor_name text,
  actor_role text,
  action text NOT NULL, -- created | updated | deactivated | reactivated | deleted
  field text,           -- nullable for non-field events
  old_value text,
  new_value text,
  summary text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.cash_tx_activities TO authenticated;
GRANT ALL ON public.cash_tx_activities TO service_role;

ALTER TABLE public.cash_tx_activities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cashact_select_all ON public.cash_tx_activities;
CREATE POLICY cashact_select_all ON public.cash_tx_activities FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS cashact_insert_auth ON public.cash_tx_activities;
CREATE POLICY cashact_insert_auth ON public.cash_tx_activities FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);

CREATE INDEX IF NOT EXISTS cash_tx_activities_tx_idx ON public.cash_tx_activities(tx_id, created_at DESC);

-- 3) Helper: resolve display name & role for current auth user
CREATE OR REPLACE FUNCTION public.current_actor()
RETURNS TABLE(uid uuid, display_name text, role text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    auth.uid(),
    COALESCE((SELECT p.display_name FROM public.profiles p WHERE p.id = auth.uid()),
             (SELECT p.email FROM public.profiles p WHERE p.id = auth.uid())),
    COALESCE(
      (SELECT r.role::text FROM public.user_roles r WHERE r.user_id = auth.uid()
        ORDER BY CASE r.role::text WHEN 'admin' THEN 1 WHEN 'owner' THEN 2 ELSE 3 END LIMIT 1),
      'staff'
    );
$$;

-- 4) Trigger: log create/update/soft-delete on cash_transactions
CREATE OR REPLACE FUNCTION public.cashtx_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a record;
BEGIN
  SELECT * INTO a FROM public.current_actor();
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.cash_tx_activities(tx_id, actor_id, actor_name, actor_role, action, summary)
    VALUES (NEW.id, a.uid, a.display_name, a.role, 'created',
      CONCAT(CASE WHEN NEW.kind='collection' THEN 'Created Cash Collection' ELSE 'Created Cash Expense' END,
             ' · ', NEW.type_name, ' · ₹', NEW.amount::text));
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    -- soft delete / reactivate
    IF OLD.active IS DISTINCT FROM NEW.active THEN
      INSERT INTO public.cash_tx_activities(tx_id, actor_id, actor_name, actor_role, action, summary)
      VALUES (NEW.id, a.uid, a.display_name, a.role,
        CASE WHEN NEW.active THEN 'reactivated' ELSE 'deactivated' END,
        CASE WHEN NEW.active THEN 'Reactivated transaction' ELSE 'Deactivated transaction' END);
    END IF;
    -- field-level diffs (only for material business fields)
    IF OLD.amount IS DISTINCT FROM NEW.amount THEN
      INSERT INTO public.cash_tx_activities(tx_id, actor_id, actor_name, actor_role, action, field, old_value, new_value, summary)
      VALUES (NEW.id, a.uid, a.display_name, a.role, 'updated', 'Amount', OLD.amount::text, NEW.amount::text, 'Amount changed');
    END IF;
    IF OLD.type_name IS DISTINCT FROM NEW.type_name THEN
      INSERT INTO public.cash_tx_activities(tx_id, actor_id, actor_name, actor_role, action, field, old_value, new_value, summary)
      VALUES (NEW.id, a.uid, a.display_name, a.role, 'updated', 'Type', OLD.type_name, NEW.type_name, 'Type changed');
    END IF;
    IF COALESCE(OLD.description,'') IS DISTINCT FROM COALESCE(NEW.description,'') THEN
      INSERT INTO public.cash_tx_activities(tx_id, actor_id, actor_name, actor_role, action, field, old_value, new_value, summary)
      VALUES (NEW.id, a.uid, a.display_name, a.role, 'updated', 'Description', OLD.description, NEW.description, 'Description changed');
    END IF;
    IF COALESCE(OLD.notes,'') IS DISTINCT FROM COALESCE(NEW.notes,'') THEN
      INSERT INTO public.cash_tx_activities(tx_id, actor_id, actor_name, actor_role, action, field, old_value, new_value, summary)
      VALUES (NEW.id, a.uid, a.display_name, a.role, 'updated', 'Notes', OLD.notes, NEW.notes, 'Notes changed');
    END IF;
    IF COALESCE(OLD.guest_name,'') IS DISTINCT FROM COALESCE(NEW.guest_name,'') THEN
      INSERT INTO public.cash_tx_activities(tx_id, actor_id, actor_name, actor_role, action, field, old_value, new_value, summary)
      VALUES (NEW.id, a.uid, a.display_name, a.role, 'updated', 'Guest Name', OLD.guest_name, NEW.guest_name, 'Guest name changed');
    END IF;
    IF COALESCE(OLD.guest_mobile,'') IS DISTINCT FROM COALESCE(NEW.guest_mobile,'') THEN
      INSERT INTO public.cash_tx_activities(tx_id, actor_id, actor_name, actor_role, action, field, old_value, new_value, summary)
      VALUES (NEW.id, a.uid, a.display_name, a.role, 'updated', 'Guest Mobile', OLD.guest_mobile, NEW.guest_mobile, 'Guest mobile changed');
    END IF;
    IF COALESCE(OLD.room_number,'') IS DISTINCT FROM COALESCE(NEW.room_number,'') THEN
      INSERT INTO public.cash_tx_activities(tx_id, actor_id, actor_name, actor_role, action, field, old_value, new_value, summary)
      VALUES (NEW.id, a.uid, a.display_name, a.role, 'updated', 'Room', OLD.room_number, NEW.room_number, 'Room changed');
    END IF;
    IF COALESCE(OLD.staff_id::text,'') IS DISTINCT FROM COALESCE(NEW.staff_id::text,'') THEN
      INSERT INTO public.cash_tx_activities(tx_id, actor_id, actor_name, actor_role, action, field, old_value, new_value, summary)
      VALUES (NEW.id, a.uid, a.display_name, a.role, 'updated', 'Staff', OLD.staff_name, NEW.staff_name, 'Staff changed');
    END IF;
    IF OLD.occurred_at IS DISTINCT FROM NEW.occurred_at THEN
      INSERT INTO public.cash_tx_activities(tx_id, actor_id, actor_name, actor_role, action, field, old_value, new_value, summary)
      VALUES (NEW.id, a.uid, a.display_name, a.role, 'updated', 'Date', OLD.occurred_at::text, NEW.occurred_at::text, 'Date/Time changed');
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.cash_tx_activities(tx_id, actor_id, actor_name, actor_role, action, summary)
    VALUES (OLD.id, a.uid, a.display_name, a.role, 'deleted', 'Deleted transaction');
    RETURN OLD;
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS cashtx_audit_ins ON public.cash_transactions;
CREATE TRIGGER cashtx_audit_ins AFTER INSERT ON public.cash_transactions
FOR EACH ROW EXECUTE FUNCTION public.cashtx_audit();

DROP TRIGGER IF EXISTS cashtx_audit_upd ON public.cash_transactions;
CREATE TRIGGER cashtx_audit_upd AFTER UPDATE ON public.cash_transactions
FOR EACH ROW EXECUTE FUNCTION public.cashtx_audit();

DROP TRIGGER IF EXISTS cashtx_audit_del ON public.cash_transactions;
CREATE TRIGGER cashtx_audit_del AFTER DELETE ON public.cash_transactions
FOR EACH ROW EXECUTE FUNCTION public.cashtx_audit();
