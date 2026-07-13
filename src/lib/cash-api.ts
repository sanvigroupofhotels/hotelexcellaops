import { supabase } from "@/integrations/supabase/client";
import { normalizeOrThrow } from "@/lib/phone";

/** Canonicalize a guest_mobile in-place. Empty/undefined passes through. Invalid throws. */
function canonicalizeCashPhone<T extends { guest_mobile?: string | null }>(input: T): T {
  if (input.guest_mobile && String(input.guest_mobile).trim() !== "") {
    return { ...input, guest_mobile: normalizeOrThrow(input.guest_mobile) };
  }
  return input;
}

export const COLLECTION_TYPES = [
  "Room Rent",
  "Advance Payment",
  "Food Charges",
  "Laundry Charges",
  "Security Deposit",
  "Other",
] as const;

export interface StaffRow { id: string; user_id: string; name: string; mobile: string | null; active: boolean; available_in_cashbook: boolean; available_in_dues: boolean; available_in_complaints: boolean; created_at: string; updated_at: string; }
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
export interface CashTxActivity {
  id: string; tx_id: string;
  actor_id: string | null; actor_name: string | null; actor_role: string | null;
  action: "created" | "updated" | "deactivated" | "reactivated" | "deleted";
  field: string | null; old_value: string | null; new_value: string | null;
  summary: string | null; created_at: string;
}

// ---------- Staff ----------
export async function listStaff(activeOnly = false, opts?: { availability?: "cashbook" | "dues" | "complaints" }) {
  let q = supabase.from("staff" as any).select("*").order("name");
  if (activeOnly) q = q.eq("active", true);
  if (opts?.availability === "cashbook") q = q.eq("available_in_cashbook", true);
  if (opts?.availability === "dues") q = q.eq("available_in_dues", true);
  if (opts?.availability === "complaints") q = q.eq("available_in_complaints", true);
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
export async function updateStaff(id: string, patch: Partial<Pick<StaffRow, "name" | "mobile" | "active" | "available_in_cashbook" | "available_in_dues" | "available_in_complaints">>) {
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

export async function listCashTx(opts?: { from?: string; to?: string; includeInactive?: boolean }) {
  let q = supabase.from("cash_transactions" as any).select("*");
  if (!opts?.includeInactive) q = q.eq("active", true);
  if (opts?.from) q = q.gte("occurred_at", opts.from);
  if (opts?.to) q = q.lte("occurred_at", opts.to);
  const { data, error } = await q.order("occurred_at", { ascending: false }).limit(500);
  if (error) throw error;
  return (data ?? []) as unknown as CashTxRow[];
}

export async function getCurrentCashBalance() {
  let from = 0;
  let balance = 0;
  while (true) {
    const { data, error } = await supabase
      .from("cash_transactions" as any)
      .select("kind, amount")
      .eq("active", true)
      .range(from, from + 999);
    if (error) throw error;
    const rows = (data ?? []) as unknown as Array<{ kind: "collection" | "expense"; amount: number }>;
    balance += rows.reduce((sum, t) => sum + (t.kind === "collection" ? Number(t.amount) : -Number(t.amount)), 0);
    if (rows.length < 1000) break;
    from += 1000;
  }
  return balance;
}

export async function getCashTx(id: string) {
  const { data, error } = await supabase.from("cash_transactions" as any).select("*").eq("id", id).single();
  if (error) throw error;
  return data as unknown as CashTxRow;
}

function validate(input: Partial<CashTxInput> & { kind: "collection"|"expense"; type_name: string; amount: number; staff_id?: string|null }) {
  const isOther = input.type_name === "Other" || input.type_name === "Others";
  if (input.kind === "collection" && !isOther) {
    if (!input.guest_name?.trim()) throw new Error("Guest name is required");
    if (!input.guest_mobile?.trim()) throw new Error("Guest mobile is required");
  }
  if (!input.type_name) throw new Error("Type is required");
  if (isOther && !input.description?.trim()) throw new Error("Description is required when type is Other");
  if (!input.staff_id) throw new Error("Staff is required");
  if (!(input.amount > 0)) throw new Error("Amount must be greater than zero");
}

export async function createCashTx(input: CashTxInput) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  const normalized = canonicalizeCashPhone(input);
  validate(normalized);
  const row: any = {
    user_id: user.id, modified_by: user.id,
    occurred_at: normalized.occurred_at ?? new Date().toISOString(),
    ...normalized,
  };
  const { data, error } = await supabase.from("cash_transactions" as any).insert(row).select().single();
  if (error) throw error;
  return data as unknown as CashTxRow;
}

export async function updateCashTx(id: string, patch: Partial<CashTxInput>) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  const normalized = canonicalizeCashPhone(patch);
  const merged: any = { ...normalized, modified_by: user.id };
  if (normalized.occurred_at) merged.occurred_at = new Date(normalized.occurred_at).toISOString();
  const { data, error } = await supabase.from("cash_transactions" as any).update(merged).eq("id", id).select().single();
  if (error) throw error;
  return data as unknown as CashTxRow;
}

/** Soft-delete (set active=false). Allowed for staff/owner/admin. */
export async function softDeleteCashTx(id: string) {
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase.from("cash_transactions" as any)
    .update({ active: false, modified_by: user?.id ?? null } as any).eq("id", id);
  if (error) throw error;
}

/** Reactivate a deactivated transaction. */
export async function reactivateCashTx(id: string) {
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase.from("cash_transactions" as any)
    .update({ active: true, modified_by: user?.id ?? null } as any).eq("id", id);
  if (error) throw error;
}

/** Hard-delete — admin only via RLS. */
export async function hardDeleteCashTx(id: string) {
  const { error } = await supabase.from("cash_transactions" as any).delete().eq("id", id);
  if (error) throw error;
}

// ---------- Activity log ----------
export async function listCashTxActivities(txId: string) {
  const { data, error } = await supabase.from("cash_tx_activities" as any)
    .select("*").eq("tx_id", txId).order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as CashTxActivity[];
}

/** Returns name of the user who created the tx (from the first 'created' activity, fall back to profile of user_id). */
export async function getCashTxCreator(tx: CashTxRow): Promise<{ name: string | null; role: string | null; at: string } | null> {
  const { data } = await supabase.from("cash_tx_activities" as any)
    .select("actor_name, actor_role, created_at")
    .eq("tx_id", tx.id).eq("action", "created")
    .order("created_at", { ascending: true }).limit(1).maybeSingle();
  if (data) return { name: (data as any).actor_name, role: (data as any).actor_role, at: (data as any).created_at };
  return { name: null, role: null, at: tx.created_at };
}

// ---------- Cash Tx Attachments (UAT-031) ----------
export interface CashTxAttachment {
  id: string;
  tx_id: string;
  user_id: string;
  storage_path: string;
  mime_type: string;
  file_size: number | null;
  original_filename: string | null;
  uploaded_by: string | null;
  uploaded_by_name: string | null;
  created_at: string;
}

export const CASH_TX_ATTACHMENT_BUCKET = "cash-tx-attachments";
/** FO Staff must attach at least one bill on Cash Out above this INR amount. */
export const CASH_OUT_ATTACHMENT_THRESHOLD_INR = 300;

export async function listCashTxAttachments(txId: string): Promise<CashTxAttachment[]> {
  const { data, error } = await supabase
    .from("cash_tx_attachments" as any)
    .select("*")
    .eq("tx_id", txId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as CashTxAttachment[];
}

async function logCashAttachmentActivity(
  txId: string,
  action: "attachment_added" | "attachment_replaced" | "attachment_deleted",
  summary: string,
) {
  const { data: { user } } = await supabase.auth.getUser();
  let name: string | null = null;
  let role: string | null = null;
  if (user) {
    const [{ data: prof }, { data: roleRow }] = await Promise.all([
      supabase.from("profiles" as any).select("display_name, email").eq("id", user.id).maybeSingle(),
      supabase.from("user_roles" as any).select("role").eq("user_id", user.id).limit(1).maybeSingle(),
    ]);
    name = (prof as any)?.display_name ?? (prof as any)?.email ?? null;
    role = (roleRow as any)?.role ?? null;
  }
  await supabase.from("cash_tx_activities" as any).insert({
    tx_id: txId,
    actor_id: user?.id ?? null,
    actor_name: name,
    actor_role: role,
    action,
    summary,
  } as any);
}

export async function uploadCashTxAttachment(txId: string, file: File): Promise<CashTxAttachment> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  const ext = (file.name.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
  const path = `${user.id}/${txId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const up = await supabase.storage.from(CASH_TX_ATTACHMENT_BUCKET).upload(path, file, {
    contentType: file.type || "application/octet-stream",
    upsert: false,
  });
  if (up.error) throw up.error;

  const { data: prof } = await supabase.from("profiles" as any)
    .select("display_name, email").eq("id", user.id).maybeSingle();
  const uploader_name = (prof as any)?.display_name ?? (prof as any)?.email ?? null;

  const { data, error } = await supabase.from("cash_tx_attachments" as any).insert({
    tx_id: txId,
    user_id: user.id,
    storage_path: path,
    mime_type: file.type || "application/octet-stream",
    file_size: file.size ?? null,
    original_filename: file.name ?? null,
    uploaded_by: user.id,
    uploaded_by_name: uploader_name,
  } as any).select().single();
  if (error) {
    // Roll back the upload if the metadata insert failed.
    await supabase.storage.from(CASH_TX_ATTACHMENT_BUCKET).remove([path]).catch(() => {});
    throw error;
  }
  await logCashAttachmentActivity(
    txId,
    "attachment_added",
    `Attachment added · ${file.name ?? "file"}`,
  );
  return data as unknown as CashTxAttachment;
}

export async function deleteCashTxAttachment(attachmentId: string) {
  const { data: row, error: readErr } = await supabase
    .from("cash_tx_attachments" as any)
    .select("id, tx_id, storage_path, original_filename")
    .eq("id", attachmentId)
    .maybeSingle();
  if (readErr) throw readErr;
  if (!row) return;
  const r: any = row;
  const { error } = await supabase.from("cash_tx_attachments" as any).delete().eq("id", attachmentId);
  if (error) throw error;
  await supabase.storage.from(CASH_TX_ATTACHMENT_BUCKET).remove([r.storage_path]).catch(() => {});
  await logCashAttachmentActivity(
    r.tx_id,
    "attachment_deleted",
    `Attachment removed · ${r.original_filename ?? "file"}`,
  );
}

export async function replaceCashTxAttachment(attachmentId: string, file: File): Promise<CashTxAttachment> {
  const { data: row } = await supabase
    .from("cash_tx_attachments" as any)
    .select("id, tx_id, storage_path, original_filename")
    .eq("id", attachmentId)
    .maybeSingle();
  if (!row) throw new Error("Attachment not found");
  const r: any = row;
  // Delete old row + object, then insert new (logs internally).
  await supabase.from("cash_tx_attachments" as any).delete().eq("id", attachmentId);
  await supabase.storage.from(CASH_TX_ATTACHMENT_BUCKET).remove([r.storage_path]).catch(() => {});
  const created = await uploadCashTxAttachment(r.tx_id, file);
  // Log replaced (uploadCashTxAttachment already logged 'attachment_added');
  // add a 'replaced' summary as the canonical event for audit.
  await logCashAttachmentActivity(
    r.tx_id,
    "attachment_replaced",
    `Attachment replaced · ${r.original_filename ?? "old"} → ${file.name ?? "new"}`,
  );
  return created;
}

export async function signedCashTxAttachmentUrl(storagePath: string, expires = 300): Promise<string | null> {
  const { data } = await supabase.storage.from(CASH_TX_ATTACHMENT_BUCKET).createSignedUrl(storagePath, expires);
  return data?.signedUrl ?? null;
}

