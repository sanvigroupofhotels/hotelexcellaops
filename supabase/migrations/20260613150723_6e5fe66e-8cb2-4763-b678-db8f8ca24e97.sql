
-- 1. Extend staff
ALTER TABLE public.staff
  ADD COLUMN IF NOT EXISTS employee_code text,
  ADD COLUMN IF NOT EXISTS designation text,
  ADD COLUMN IF NOT EXISTS department text,
  ADD COLUMN IF NOT EXISTS date_of_joining date,
  ADD COLUMN IF NOT EXISTS basic_salary numeric(12,2),
  ADD COLUMN IF NOT EXISTS monthly_salary numeric(12,2),
  ADD COLUMN IF NOT EXISTS food_provided boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS accommodation_provided boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS staff_employee_code_uniq
  ON public.staff (employee_code) WHERE employee_code IS NOT NULL;

-- 2. Attendance status enum
DO $$ BEGIN
  CREATE TYPE public.attendance_status AS ENUM ('Present','Absent','HalfDay','Leave');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3. staff_attendance
CREATE TABLE IF NOT EXISTS public.staff_attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  staff_id uuid NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  date date NOT NULL,
  status public.attendance_status NOT NULL,
  check_in_time time,
  check_out_time time,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (staff_id, date)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff_attendance TO authenticated;
GRANT ALL ON public.staff_attendance TO service_role;
ALTER TABLE public.staff_attendance ENABLE ROW LEVEL SECURITY;
CREATE POLICY "attendance_select_all" ON public.staff_attendance FOR SELECT TO authenticated USING (true);
CREATE POLICY "attendance_insert_admin" ON public.staff_attendance FOR INSERT TO authenticated WITH CHECK (is_admin() AND auth.uid() = user_id);
CREATE POLICY "attendance_update_admin" ON public.staff_attendance FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "attendance_delete_admin" ON public.staff_attendance FOR DELETE TO authenticated USING (is_admin());
CREATE TRIGGER staff_attendance_set_updated_at BEFORE UPDATE ON public.staff_attendance FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX IF NOT EXISTS staff_attendance_date_idx ON public.staff_attendance (date);
CREATE INDEX IF NOT EXISTS staff_attendance_staff_idx ON public.staff_attendance (staff_id, date);

-- 4. salary_advances
CREATE TABLE IF NOT EXISTS public.salary_advances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  staff_id uuid NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  advance_date date NOT NULL DEFAULT CURRENT_DATE,
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  notes text,
  recovered_in_month text, -- 'YYYY-MM'
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.salary_advances TO authenticated;
GRANT ALL ON public.salary_advances TO service_role;
ALTER TABLE public.salary_advances ENABLE ROW LEVEL SECURITY;
CREATE POLICY "advances_select_all" ON public.salary_advances FOR SELECT TO authenticated USING (true);
CREATE POLICY "advances_insert_admin" ON public.salary_advances FOR INSERT TO authenticated WITH CHECK (is_admin() AND auth.uid() = user_id);
CREATE POLICY "advances_update_admin" ON public.salary_advances FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "advances_delete_admin" ON public.salary_advances FOR DELETE TO authenticated USING (is_admin());
CREATE TRIGGER salary_advances_set_updated_at BEFORE UPDATE ON public.salary_advances FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX IF NOT EXISTS salary_advances_staff_idx ON public.salary_advances (staff_id);

-- 5. salary_payments
CREATE TABLE IF NOT EXISTS public.salary_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  staff_id uuid NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  month text NOT NULL, -- 'YYYY-MM'
  salary_period_from date,
  salary_period_to date,
  gross numeric(12,2) NOT NULL DEFAULT 0,
  bonus numeric(12,2) NOT NULL DEFAULT 0,
  incentives numeric(12,2) NOT NULL DEFAULT 0,
  present_days numeric(6,2) NOT NULL DEFAULT 0,
  absent_days numeric(6,2) NOT NULL DEFAULT 0,
  halfday_count numeric(6,2) NOT NULL DEFAULT 0,
  leave_days numeric(6,2) NOT NULL DEFAULT 0,
  working_days_basis text NOT NULL DEFAULT '30',
  absent_deduction numeric(12,2) NOT NULL DEFAULT 0,
  halfday_deduction numeric(12,2) NOT NULL DEFAULT 0,
  advance_recovery numeric(12,2) NOT NULL DEFAULT 0,
  other_deductions numeric(12,2) NOT NULL DEFAULT 0,
  net numeric(12,2) NOT NULL DEFAULT 0,
  paid_amount numeric(12,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'Pending', -- Pending | Partial | Paid
  payment_mode text,
  paid_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (staff_id, month)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.salary_payments TO authenticated;
GRANT ALL ON public.salary_payments TO service_role;
ALTER TABLE public.salary_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "salary_select_all" ON public.salary_payments FOR SELECT TO authenticated USING (true);
CREATE POLICY "salary_insert_admin" ON public.salary_payments FOR INSERT TO authenticated WITH CHECK (is_admin() AND auth.uid() = user_id);
CREATE POLICY "salary_update_admin" ON public.salary_payments FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "salary_delete_admin" ON public.salary_payments FOR DELETE TO authenticated USING (is_admin());
CREATE TRIGGER salary_payments_set_updated_at BEFORE UPDATE ON public.salary_payments FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX IF NOT EXISTS salary_payments_month_idx ON public.salary_payments (month);
CREATE INDEX IF NOT EXISTS salary_payments_staff_idx ON public.salary_payments (staff_id, month);
