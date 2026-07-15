/**
 * UAT-033 — Customer Phones API
 *
 * A customer represents ONE real person. That person may have multiple mobile
 * numbers, exactly one of which is marked Primary. The legacy
 * `customers.phone` column is kept in sync (via DB trigger) with the primary
 * phone so every existing read path — search, WhatsApp deep links, invoice
 * headers, autocomplete, CSV exports — keeps working unchanged.
 *
 * Duplicate phone numbers across different customers are blocked at the DB
 * layer (unique index).
 */
import { supabase } from "@/integrations/supabase/client";
import { normalizePhoneNumber, validatePhoneNumber } from "@/lib/phone";
import { logActivity } from "@/lib/activity-log";

export interface CustomerPhoneRow {
  id: string;
  customer_id: string;
  user_id: string;
  phone: string;
  label: string | null;
  is_primary: boolean;
  created_at: string;
  updated_at: string;
}

export async function listCustomerPhones(customerId: string): Promise<CustomerPhoneRow[]> {
  const { data, error } = await supabase
    .from("customer_phones" as any)
    .select("*")
    .eq("customer_id", customerId)
    .order("is_primary", { ascending: false })
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as CustomerPhoneRow[];
}

function normalize(phone: string) {
  const n = normalizePhoneNumber(phone);
  if (!validatePhoneNumber(n)) throw new Error("Please enter a valid mobile number.");
  return n;
}

function friendlyDuplicateError(err: any) {
  if (err?.code === "23505" || /customer_phones_phone_unique|duplicate key/i.test(err?.message ?? "")) {
    return new Error("This mobile number is already linked to another customer. Please search and use the existing record.");
  }
  return err;
}

export async function addCustomerPhone(customerId: string, phone: string, label?: string, makePrimary = false): Promise<CustomerPhoneRow> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  const p = normalize(phone);
  // If caller asks to promote as primary, demote existing first
  if (makePrimary) {
    await supabase.from("customer_phones" as any).update({ is_primary: false } as any).eq("customer_id", customerId);
  }
  const { data, error } = await supabase
    .from("customer_phones" as any)
    .insert({ customer_id: customerId, user_id: user.id, phone: p, label: label ?? null, is_primary: makePrimary } as any)
    .select().single();
  if (error) throw friendlyDuplicateError(error);
  const row = data as unknown as CustomerPhoneRow;
  void logActivity({
    page: "Customers", action: "customer_phone_added",
    entity_type: "customer", entity_id: customerId, entity_reference: p,
    summary: `Phone added · ${p}${label ? ` · ${label}` : ""}${makePrimary ? " · Primary" : ""}`,
    after: { phone: p, label, is_primary: makePrimary }, source: "manual",
  });
  return row;
}

export async function updateCustomerPhone(id: string, patch: { phone?: string; label?: string | null }) {
  const payload: any = { ...patch };
  if (payload.phone !== undefined) payload.phone = normalize(payload.phone);
  const { error } = await supabase.from("customer_phones" as any).update(payload).eq("id", id);
  if (error) throw friendlyDuplicateError(error);
}

export async function deleteCustomerPhone(id: string) {
  // Cannot delete the last remaining phone number (customer must have at least one).
  const { data: row } = await supabase.from("customer_phones" as any).select("customer_id, is_primary").eq("id", id).maybeSingle();
  const customerId = (row as any)?.customer_id as string | undefined;
  const isPrimary = !!(row as any)?.is_primary;
  if (customerId) {
    const { count } = await supabase
      .from("customer_phones" as any)
      .select("id", { count: "exact", head: true })
      .eq("customer_id", customerId);
    if ((count ?? 0) <= 1) throw new Error("Cannot delete the only phone number. Add another first or promote a replacement.");
    if (isPrimary) throw new Error("Cannot delete the Primary phone number. Promote another number to Primary first.");
  }
  const { error } = await supabase.from("customer_phones" as any).delete().eq("id", id);
  if (error) throw error;
}

export async function promoteCustomerPhone(id: string) {
  const { data: row, error: e1 } = await supabase.from("customer_phones" as any).select("customer_id").eq("id", id).maybeSingle();
  if (e1) throw e1;
  const customerId = (row as any)?.customer_id as string | undefined;
  if (!customerId) throw new Error("Phone number not found");
  // Demote existing primary, then promote target.
  await supabase.from("customer_phones" as any).update({ is_primary: false } as any).eq("customer_id", customerId);
  const { error } = await supabase.from("customer_phones" as any).update({ is_primary: true } as any).eq("id", id);
  if (error) throw error;
  void logActivity({
    page: "Customers", action: "customer_phone_primary_set",
    entity_type: "customer", entity_id: customerId, entity_reference: id,
    summary: "Primary phone changed", source: "manual",
  });
}

/**
 * Resolve a customer from ANY of their registered phone numbers. Returns
 * customer_id or null. Consumers that also want the customer row can chain
 * with getCustomer(). The DB unique index guarantees at most one match.
 */
export async function findCustomerByAnyPhone(rawPhone: string): Promise<string | null> {
  const p = normalizePhoneNumber(rawPhone);
  if (!p) return null;
  const { data, error } = await supabase
    .from("customer_phones" as any)
    .select("customer_id")
    .eq("phone", p)
    .maybeSingle();
  if (error) return null;
  return ((data as any)?.customer_id ?? null) as string | null;
}
