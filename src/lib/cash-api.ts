import { supabase } from "@/integrations/supabase/client";

export const COLLECTION_TYPES = [
  "Room Rent",
  "Advance Payment",
  "Food Charges",
  "Laundry Charges",
  "Security Deposit",
  "Other",
] as const;

export interface StaffRow { id: string; user_id: string; name: string; mobile: string | null; active: boolean; created_at: string; updated_at: string; }
export interface ExpenseTypeRow { id: string; user_id: string; name: string; active: boolean; created_at: string; updated_at: string; }
export interface CashTxRow {
  id: string; user_id: string;
  kind: "collection" | "expense";
  type_name: string; description: string | null;
  guest_name: string | null; guest_mobile: string | null; room_number: string | null;
  booking_id: string | null; customer_id: string | null;
  staff_id: string | null; staff_name: string | null;
  amount: number; notes: string | null;
  occurred_at: string; active: boolean;
  modified_by: string | null;
  created_at: string; updated_at: string;
}

// ---------- Staff ----------
export async function listStaff(activeOnly = false) {
  let q = supabase.from("staff" as any).select("*").order("name");
  if (activeOnly) q = q.eq("active", true);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as unknown as StaffRow[];
}
export async function createStaff(name: string, mobile?: string) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  const { data, error } = await supabase.from("staff" as any)
    .insert({ user_id: user.id, name, mobile: mobile ?? null } as any).select().single();
  if (error) throw error; return data as unknown as StaffRow;
}
export async function updateStaff(id: string, patch: Partial<Pick<StaffRow, "name" | "mobile" | "active">>) {
  const { error } = await supabase.from("staff" as any).update(patch as any).eq("id", id);
  if (error) throw error;
}

// ---------- Expense Types ----------
export async function listExpenseTypes(activeOnly = false) {
  let q = supabase.from("expense_types" as any).select("*").order("name");
  if (activeOnly) q = q.eq("active", true);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as unknown as ExpenseTypeRow[];
}
export async function createExpenseType(name: string) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  const { data, error } = await supabase.from("expense_types" as any)
    .insert({ user_id: user.id, name } as any).select().single();
  if (error) throw error; return data as unknown as ExpenseTypeRow;
}
export async function updateExpenseType(id: string, patch: Partial<Pick<ExpenseTypeRow, "name" | "active">>) {
  const { error } = await supabase.from("expense_types" as any).update(patch as any).eq("id", id);
  if (error) throw error;
}

// ---------- Cash Transactions ----------
export interface CashTxInput {
  kind: "collection" | "expense";
  type_name: string;
  description?: string | null;
  guest_name?: string | null;
  guest_mobile?: string | null;
  room_number?: string | null;
  booking_id?: string | null;
  customer_id?: string | null;
  staff_id?: string | null;
  staff_name?: string | null;
  amount: number;
  notes?: string | null;
  occurred_at?: string;
}

export async function listCashTx(opts?: { from?: string; to?: string }) {
  let q = supabase.from("cash_transactions" as any).select("*").eq("active", true);
  if (opts?.from) q = q.gte("occurred_at", opts.from);
  if (opts?.to) q = q.lte("occurred_at", opts.to);
  const { data, error } = await q.order("occurred_at", { ascending: false }).limit(500);
  if (error) throw error;
  return (data ?? []) as unknown as CashTxRow[];
}

export async function createCashTx(input: CashTxInput) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  if (input.kind === "collection") {
    if (!input.guest_name?.trim()) throw new Error("Guest name is required");
    if (!input.guest_mobile?.trim()) throw new Error("Guest mobile is required");
  }
  if (!input.type_name) throw new Error("Type is required");
  if (input.type_name === "Other" || input.type_name === "Others") {
    if (!input.description?.trim()) throw new Error("Description is required when type is Other");
  }
  if (!input.staff_id) throw new Error("Staff is required");
  if (!(input.amount > 0)) throw new Error("Amount must be greater than zero");
  const row: any = {
    user_id: user.id, modified_by: user.id,
    occurred_at: input.occurred_at ?? new Date().toISOString(),
    ...input,
  };
  const { data, error } = await supabase.from("cash_transactions" as any).insert(row).select().single();
  if (error) throw error;
  return data as unknown as CashTxRow;
}

export async function softDeleteCashTx(id: string) {
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase.from("cash_transactions" as any)
    .update({ active: false, modified_by: user?.id ?? null } as any).eq("id", id);
  if (error) throw error;
}
