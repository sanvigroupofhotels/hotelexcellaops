
-- ===== 1. CASHBOOK AUDIT CLOSE =====

CREATE TABLE IF NOT EXISTS public.cash_audit_closes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  closed_through_date date NOT NULL,
  closed_by uuid REFERENCES auth.users(id),
  closed_by_name text,
  closed_at timestamptz NOT NULL DEFAULT now(),
  reopened_by uuid REFERENCES auth.users(id),
  reopened_by_name text,
  reopened_at timestamptz,
  reopen_reason text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cash_audit_closes TO authenticated;
GRANT ALL ON public.cash_audit_closes TO service_role;
ALTER TABLE public.cash_audit_closes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cac_select_auth" ON public.cash_audit_closes FOR SELECT TO authenticated USING (true);
CREATE POLICY "cac_admin_write" ON public.cash_audit_closes FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE TRIGGER cac_set_updated BEFORE UPDATE ON public.cash_audit_closes FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS cac_active_date_idx ON public.cash_audit_closes(active, closed_through_date DESC);

-- Helper: is a given timestamp covered by an active audit close?
CREATE OR REPLACE FUNCTION public.is_cash_tx_locked(p_occurred_at timestamptz)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.cash_audit_closes
    WHERE active = true
      AND (p_occurred_at AT TIME ZONE 'Asia/Kolkata')::date <= closed_through_date
  );
$$;

-- Tighten cash_transactions UPDATE/DELETE policies: block staff/owner on locked dates
DROP POLICY IF EXISTS "cashtx_update_auth" ON public.cash_transactions;
CREATE POLICY "cashtx_update_auth" ON public.cash_transactions
  FOR UPDATE TO authenticated
  USING (public.is_admin() OR NOT public.is_cash_tx_locked(occurred_at))
  WITH CHECK (public.is_admin() OR NOT public.is_cash_tx_locked(occurred_at));

DROP POLICY IF EXISTS "cashtx_delete_admin" ON public.cash_transactions;
CREATE POLICY "cashtx_delete_admin" ON public.cash_transactions
  FOR DELETE TO authenticated
  USING (public.is_admin());

-- Activity log for audit close events
CREATE TABLE IF NOT EXISTS public.cash_audit_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_close_id uuid REFERENCES public.cash_audit_closes(id) ON DELETE CASCADE,
  actor_id uuid,
  actor_name text,
  actor_role text,
  action text NOT NULL, -- 'audit_closed' | 'audit_reopened' | 'audit_closed_again'
  closed_through_date date,
  reason text,
  summary text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.cash_audit_activities TO authenticated;
GRANT ALL ON public.cash_audit_activities TO service_role;
ALTER TABLE public.cash_audit_activities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "caa_select_auth" ON public.cash_audit_activities FOR SELECT TO authenticated USING (true);
CREATE POLICY "caa_admin_insert" ON public.cash_audit_activities FOR INSERT TO authenticated WITH CHECK (public.is_admin());

CREATE OR REPLACE FUNCTION public.cash_audit_close_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a record; has_prior boolean;
BEGIN
  SELECT * INTO a FROM public.current_actor();
  IF TG_OP = 'INSERT' THEN
    SELECT EXISTS(SELECT 1 FROM public.cash_audit_closes WHERE id <> NEW.id) INTO has_prior;
    INSERT INTO public.cash_audit_activities(audit_close_id, actor_id, actor_name, actor_role, action, closed_through_date, summary)
    VALUES (NEW.id, a.uid, a.display_name, a.role,
      CASE WHEN has_prior THEN 'audit_closed_again' ELSE 'audit_closed' END,
      NEW.closed_through_date,
      CONCAT('Audit closed through ', NEW.closed_through_date::text));
  ELSIF TG_OP = 'UPDATE' AND OLD.active = true AND NEW.active = false THEN
    INSERT INTO public.cash_audit_activities(audit_close_id, actor_id, actor_name, actor_role, action, closed_through_date, reason, summary)
    VALUES (NEW.id, a.uid, a.display_name, a.role, 'audit_reopened', NEW.closed_through_date, NEW.reopen_reason,
      CONCAT('Audit reopened · ', COALESCE(NEW.reopen_reason, 'no reason')));
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS cac_audit_ins ON public.cash_audit_closes;
DROP TRIGGER IF EXISTS cac_audit_upd ON public.cash_audit_closes;
CREATE TRIGGER cac_audit_ins AFTER INSERT ON public.cash_audit_closes FOR EACH ROW EXECUTE FUNCTION public.cash_audit_close_audit();
CREATE TRIGGER cac_audit_upd AFTER UPDATE ON public.cash_audit_closes FOR EACH ROW EXECUTE FUNCTION public.cash_audit_close_audit();

-- ===== 2. INTEGRATIONS FRAMEWORK =====

CREATE TABLE IF NOT EXISTS public.integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  provider text NOT NULL,    -- 'fabhotels' | 'hotelzify' | 'booking_com' | 'agoda' | 'razorpay' | 'whatsapp' | 'custom'
  type text NOT NULL,        -- 'email_parser' | 'api' | 'webhook' | 'csv_import'
  status text NOT NULL DEFAULT 'draft',  -- 'draft' | 'connected' | 'disabled' | 'error'
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_sync_at timestamptz,
  last_sync_status text,
  last_sync_message text,
  bookings_imported integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.integrations TO authenticated;
GRANT ALL ON public.integrations TO service_role;
ALTER TABLE public.integrations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "intg_select_auth" ON public.integrations FOR SELECT TO authenticated USING (true);
CREATE POLICY "intg_admin_write" ON public.integrations FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE TRIGGER intg_set_updated BEFORE UPDATE ON public.integrations FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.integration_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_id uuid NOT NULL REFERENCES public.integrations(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status text NOT NULL DEFAULT 'running', -- 'running' | 'success' | 'partial' | 'error'
  message text,
  created_count integer NOT NULL DEFAULT 0,
  updated_count integer NOT NULL DEFAULT 0,
  payload_excerpt text
);
GRANT SELECT, INSERT, UPDATE ON public.integration_runs TO authenticated;
GRANT ALL ON public.integration_runs TO service_role;
ALTER TABLE public.integration_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ir_select_auth" ON public.integration_runs FOR SELECT TO authenticated USING (true);
CREATE POLICY "ir_admin_write" ON public.integration_runs FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE INDEX IF NOT EXISTS ir_intg_started_idx ON public.integration_runs(integration_id, started_at DESC);

CREATE TABLE IF NOT EXISTS public.external_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_id uuid NOT NULL REFERENCES public.integrations(id) ON DELETE CASCADE,
  external_ref text NOT NULL,
  raw_payload jsonb,
  parsed jsonb,
  booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  state text NOT NULL DEFAULT 'pending', -- 'pending' | 'linked' | 'ignored' | 'failed'
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (integration_id, external_ref)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.external_bookings TO authenticated;
GRANT ALL ON public.external_bookings TO service_role;
ALTER TABLE public.external_bookings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "eb_select_auth" ON public.external_bookings FOR SELECT TO authenticated USING (true);
CREATE POLICY "eb_admin_write" ON public.external_bookings FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE TRIGGER eb_set_updated BEFORE UPDATE ON public.external_bookings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Optional dedupe columns on bookings (only add if absent)
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS integration_id uuid REFERENCES public.integrations(id) ON DELETE SET NULL;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS external_ref text;
CREATE UNIQUE INDEX IF NOT EXISTS bookings_integration_external_ref_idx
  ON public.bookings(integration_id, external_ref) WHERE integration_id IS NOT NULL AND external_ref IS NOT NULL;

-- ===== 3. MASTER DATA — seed expanded categories =====
-- (idempotent: ON CONFLICT do nothing)
INSERT INTO public.master_data (category, value, label, sort_order, active) VALUES
  ('room_category','standard','Standard',10,true),
  ('room_category','deluxe','Deluxe',20,true),
  ('room_category','suite','Suite',30,true),
  ('room_status','available','Available',10,true),
  ('room_status','occupied','Occupied',20,true),
  ('room_status','blocked','Blocked',30,true),
  ('room_status','maintenance','Maintenance',40,true),
  ('block_reason','maintenance','Maintenance',10,true),
  ('block_reason','owner_use','Owner Use',20,true),
  ('block_reason','renovation','Renovation',30,true),
  ('payment_mode','cash','Cash',10,true),
  ('payment_mode','upi','UPI',20,true),
  ('payment_mode','card','Card',30,true),
  ('payment_mode','bank_transfer','Bank Transfer',40,true),
  ('payment_mode','razorpay','Razorpay',50,true),
  ('charge_category','food','Food',10,true),
  ('charge_category','laundry','Laundry',20,true),
  ('charge_category','minibar','Mini Bar',30,true),
  ('charge_category','extra_bed','Extra Bed',40,true),
  ('charge_category','other','Other',99,true),
  ('expense_category','utilities','Utilities',10,true),
  ('expense_category','supplies','Supplies',20,true),
  ('expense_category','maintenance','Maintenance',30,true),
  ('expense_category','salary','Salary',40,true),
  ('expense_category','owner_payout','Owner Payout',50,true),
  ('expense_category','other','Other',99,true),
  ('tax','gst_12','GST 12%',10,true),
  ('tax','gst_18','GST 18%',20,true),
  ('issue_type','plumbing','Plumbing',10,true),
  ('issue_type','electrical','Electrical',20,true),
  ('issue_type','housekeeping','Housekeeping',30,true),
  ('issue_type','ac','AC',40,true),
  ('issue_type','other','Other',99,true),
  ('issue_priority','low','Low',10,true),
  ('issue_priority','medium','Medium',20,true),
  ('issue_priority','high','High',30,true),
  ('issue_priority','urgent','Urgent',40,true),
  ('cancellation_reason','guest_request','Guest Request',10,true),
  ('cancellation_reason','no_show','No Show',20,true),
  ('cancellation_reason','duplicate','Duplicate Booking',30,true),
  ('cancellation_reason','payment_failed','Payment Failed',40,true),
  ('cancellation_reason','other','Other',99,true),
  ('override_reason','manager_approval','Manager Approval',10,true),
  ('override_reason','vip_guest','VIP Guest',20,true),
  ('override_reason','corporate','Corporate Rate',30,true),
  ('override_reason','other','Other',99,true),
  ('complaint_status','open','Open',10,true),
  ('complaint_status','in_progress','In Progress',20,true),
  ('complaint_status','resolved','Resolved',30,true)
ON CONFLICT (category, value) DO NOTHING;
