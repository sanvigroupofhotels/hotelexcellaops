
-- 1) Payment OCR refinements: UTR and Paid To fields on booking_payments
ALTER TABLE public.booking_payments
  ADD COLUMN IF NOT EXISTS utr text,
  ADD COLUMN IF NOT EXISTS paid_to text;

-- 2) Night audit runs
CREATE TABLE IF NOT EXISTS public.night_audit_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_name text,
  mode text NOT NULL DEFAULT 'manual', -- 'manual' | 'auto'
  previous_business_date date,
  new_business_date date NOT NULL,
  pending_check_ins_resolved int NOT NULL DEFAULT 0,
  pending_check_outs_resolved int NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.night_audit_runs TO authenticated;
GRANT ALL ON public.night_audit_runs TO service_role;

ALTER TABLE public.night_audit_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can view night audit runs"
  ON public.night_audit_runs FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Staff can insert night audit runs"
  ON public.night_audit_runs FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id OR user_id IS NULL);

CREATE POLICY "Admins can delete night audit runs"
  ON public.night_audit_runs FOR DELETE
  TO authenticated USING (public.is_admin());
