import { supabase } from "@/integrations/supabase/client";

// ---------- Staff (extended) ----------
export interface StaffHrRow {
  id: string;
  user_id: string;
  name: string;
  mobile: string | null;
  active: boolean;
  employee_code: string | null;
  designation: string | null;
  department: string | null;
  date_of_joining: string | null;
  basic_salary: number | null;
  monthly_salary: number | null;
  food_provided: boolean;
  accommodation_provided: boolean;
  created_at: string;
  updated_at: string;
}

export async function listStaffHr(activeOnly = false): Promise<StaffHrRow[]> {
  let q = supabase.from("staff" as any).select("*").order("name");
  if (activeOnly) q = q.eq("active", true);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as unknown as StaffHrRow[];
}

export async function createStaffHr(input: Partial<StaffHrRow> & { name: string }) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  const row: any = { user_id: user.id, ...input };
  const { data, error } = await supabase.from("staff" as any).insert(row).select().single();
  if (error) throw error;
  return data as unknown as StaffHrRow;
}

export async function updateStaffHr(id: string, patch: Partial<StaffHrRow>) {
  const { error } = await supabase.from("staff" as any).update(patch as any).eq("id", id);
  if (error) throw error;
}

// ---------- Attendance ----------
export type AttendanceStatus = "Present" | "Absent" | "HalfDay" | "Leave";

export interface AttendanceRow {
  id: string;
  user_id: string;
  staff_id: string;
  date: string; // YYYY-MM-DD
  status: AttendanceStatus;
  check_in_time: string | null;
  check_out_time: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export async function listAttendance(opts: { from: string; to: string; staff_id?: string }) {
  let q = supabase.from("staff_attendance" as any).select("*").gte("date", opts.from).lte("date", opts.to);
  if (opts.staff_id) q = q.eq("staff_id", opts.staff_id);
  const { data, error } = await q.order("date");
  if (error) throw error;
  return (data ?? []) as unknown as AttendanceRow[];
}

export async function upsertAttendance(input: { staff_id: string; date: string; status: AttendanceStatus; notes?: string | null }) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  const row: any = { user_id: user.id, ...input };
  const { error } = await supabase.from("staff_attendance" as any)
    .upsert(row, { onConflict: "staff_id,date" } as any);
  if (error) throw error;
}

export async function bulkMarkPresent(staffIds: string[], date: string) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  const rows = staffIds.map((sid) => ({ user_id: user.id, staff_id: sid, date, status: "Present" as AttendanceStatus }));
  const { error } = await supabase.from("staff_attendance" as any)
    .upsert(rows as any, { onConflict: "staff_id,date" } as any);
  if (error) throw error;
}

export async function deleteAttendance(staff_id: string, date: string) {
  const { error } = await supabase.from("staff_attendance" as any).delete().eq("staff_id", staff_id).eq("date", date);
  if (error) throw error;
}

// ---------- Salary Advances ----------
export interface AdvanceRow {
  id: string;
  user_id: string;
  staff_id: string;
  advance_date: string;
  amount: number;
  notes: string | null;
  recovered_in_month: string | null;
  created_at: string;
  updated_at: string;
}

export async function listAdvances(opts?: { staff_id?: string; unrecovered?: boolean; month?: string }) {
  let q = supabase.from("salary_advances" as any).select("*").order("advance_date", { ascending: false });
  if (opts?.staff_id) q = q.eq("staff_id", opts.staff_id);
  if (opts?.unrecovered) q = q.is("recovered_in_month", null);
  if (opts?.month) q = q.eq("recovered_in_month", opts.month);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as unknown as AdvanceRow[];
}

export async function createAdvance(input: { staff_id: string; amount: number; advance_date?: string; notes?: string | null }) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  const row: any = { user_id: user.id, advance_date: input.advance_date ?? new Date().toISOString().slice(0,10), ...input };
  const { data, error } = await supabase.from("salary_advances" as any).insert(row).select().single();
  if (error) throw error;
  return data as unknown as AdvanceRow;
}

export async function deleteAdvance(id: string) {
  const { error } = await supabase.from("salary_advances" as any).delete().eq("id", id);
  if (error) throw error;
}

export async function markAdvanceRecovered(id: string, month: string | null) {
  const { error } = await supabase.from("salary_advances" as any).update({ recovered_in_month: month } as any).eq("id", id);
  if (error) throw error;
}

// ---------- Salary Payments ----------
export type SalaryStatus = "Pending" | "Partial" | "Paid";

export interface SalaryPaymentRow {
  id: string;
  user_id: string;
  staff_id: string;
  month: string;
  salary_period_from: string | null;
  salary_period_to: string | null;
  gross: number;
  bonus: number;
  incentives: number;
  present_days: number;
  absent_days: number;
  halfday_count: number;
  leave_days: number;
  working_days_basis: string;
  absent_deduction: number;
  halfday_deduction: number;
  advance_recovery: number;
  other_deductions: number;
  net: number;
  paid_amount: number;
  status: SalaryStatus;
  payment_mode: string | null;
  paid_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export async function listSalaryPayments(opts?: { month?: string; staff_id?: string }) {
  let q = supabase.from("salary_payments" as any).select("*").order("month", { ascending: false });
  if (opts?.month) q = q.eq("month", opts.month);
  if (opts?.staff_id) q = q.eq("staff_id", opts.staff_id);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as unknown as SalaryPaymentRow[];
}

export async function upsertSalaryPayment(row: Partial<SalaryPaymentRow> & { staff_id: string; month: string }) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  const payload: any = { user_id: user.id, ...row };
  const { data, error } = await supabase.from("salary_payments" as any)
    .upsert(payload, { onConflict: "staff_id,month" } as any).select().single();
  if (error) throw error;
  return data as unknown as SalaryPaymentRow;
}

export async function deleteSalaryPayment(id: string) {
  const { error } = await supabase.from("salary_payments" as any).delete().eq("id", id);
  if (error) throw error;
}

// ---------- Salary Engine ----------
export interface SalaryBasis { basis: "30" | "calendar"; }

export async function getSalaryBasis(): Promise<SalaryBasis> {
  const { data } = await supabase.from("app_settings" as any).select("value").eq("key", "salary_basis").maybeSingle();
  const v = (data as any)?.value;
  const basis = (typeof v === "string" ? v : v?.basis) === "calendar" ? "calendar" : "30";
  return { basis };
}

export async function setSalaryBasis(basis: "30" | "calendar"): Promise<void> {
  const { error } = await supabase.from("app_settings" as any)
    .upsert({ key: "salary_basis", value: { basis }, updated_at: new Date().toISOString() } as any);
  if (error) throw error;
}

export function monthKey(date: Date) {
  const y = date.getFullYear(); const m = String(date.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export function daysInMonth(month: string) {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}

export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  const mm = String(m).padStart(2, "0");
  return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${String(last).padStart(2, "0")}` };
}

export interface ComputedSalary {
  staff_id: string;
  name: string;
  monthly_salary: number;
  per_day: number;
  present_days: number;
  absent_days: number;
  halfday_count: number;
  leave_days: number;
  absent_deduction: number;
  halfday_deduction: number;
  advance_recovery: number;
  bonus: number;
  incentives: number;
  other_deductions: number;
  gross: number;
  net: number;
  unrecovered_advance_total: number;
  payment?: SalaryPaymentRow | null;
}

export function computeSalary(opts: {
  staff: StaffHrRow;
  month: string;
  basis: "30" | "calendar";
  attendance: AttendanceRow[];
  unrecoveredAdvanceTotal: number;
  existing?: SalaryPaymentRow | null;
}): ComputedSalary {
  const { staff, month, basis, attendance, unrecoveredAdvanceTotal, existing } = opts;
  const monthly = Number(staff.monthly_salary ?? 0);
  const denom = basis === "30" ? 30 : daysInMonth(month);
  const per_day = denom > 0 ? monthly / denom : 0;
  const rows = attendance.filter((a) => a.staff_id === staff.id);
  const present_days = rows.filter((r) => r.status === "Present").length;
  const absent_days = rows.filter((r) => r.status === "Absent").length;
  const halfday_count = rows.filter((r) => r.status === "HalfDay").length;
  const leave_days = rows.filter((r) => r.status === "Leave").length;
  const absent_deduction = +(per_day * absent_days).toFixed(2);
  const halfday_deduction = +(per_day * 0.5 * halfday_count).toFixed(2);
  const bonus = Number(existing?.bonus ?? 0);
  const incentives = Number(existing?.incentives ?? 0);
  const other_deductions = Number(existing?.other_deductions ?? 0);
  const advance_recovery = Number(existing?.advance_recovery ?? 0);
  const gross = monthly + bonus + incentives;
  const net = +(gross - absent_deduction - halfday_deduction - advance_recovery - other_deductions).toFixed(2);
  return {
    staff_id: staff.id,
    name: staff.name,
    monthly_salary: monthly,
    per_day: +per_day.toFixed(2),
    present_days, absent_days, halfday_count, leave_days,
    absent_deduction, halfday_deduction, advance_recovery,
    bonus, incentives, other_deductions, gross, net,
    unrecovered_advance_total: unrecoveredAdvanceTotal,
    payment: existing ?? null,
  };
}
