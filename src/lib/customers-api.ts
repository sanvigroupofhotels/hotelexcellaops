import { supabase } from "@/integrations/supabase/client";
import { normalizePhoneNumber, validatePhoneNumber } from "@/lib/phone";
import { logActivity } from "@/lib/activity-log";

export interface CustomerRow {
  id: string;
  user_id: string;
  customer_reference: string;
  guest_name: string;
  phone: string | null;
  email: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  birthday: string | null;
  anniversary: string | null;
  guest_type: string | null;
  company_name: string | null;
  company_address: string | null;
  gst_number: string | null;
  preferred_room: string | null;
  preferred_food: string | null;
  special_notes: string | null;
  lead_source: string | null;
  first_contact_date: string;
  last_stay_date: string | null;
  total_quotes: number;
  total_bookings: number;
  total_revenue: number;
  status: string;
  tags: string[];
  booking_probability: number;
  next_action: string | null;
  next_followup_date: string | null;
  payment_status: string | null;
  lost_reason: string | null;
  internal_notes: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  created_at: string;
  updated_at: string;
}

export type CustomerInput = Partial<Omit<CustomerRow, "id" | "user_id" | "created_at" | "updated_at" | "customer_reference">> & {
  guest_name: string;
};

export async function listCustomers() {
  const { data, error } = await supabase
    .from("customers" as any).select("*").order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as CustomerRow[];
}

export async function getCustomer(id: string) {
  const { data, error } = await supabase
    .from("customers" as any).select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data as unknown as CustomerRow | null;
}

export async function listCustomerQuotes(customerId: string) {
  const { data, error } = await supabase
    .from("quotes").select("*").eq("customer_id", customerId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

function normalizeCustomerPhones<T extends Partial<CustomerInput>>(input: T): T {
  const out: any = { ...input };
  if (out.phone !== undefined && out.phone !== null && String(out.phone).trim() !== "") {
    const n = normalizePhoneNumber(out.phone);
    if (!validatePhoneNumber(n)) throw new Error("Please enter a valid mobile number.");
    out.phone = n;
  }
  if (out.emergency_contact_phone && String(out.emergency_contact_phone).trim() !== "") {
    const n = normalizePhoneNumber(out.emergency_contact_phone);
    if (!validatePhoneNumber(n)) throw new Error("Please enter a valid emergency contact number.");
    out.emergency_contact_phone = n;
  }
  return out;
}

export async function updateCustomer(id: string, patch: Partial<CustomerInput>) {
  const payload = normalizeCustomerPhones(patch);
  const { data, error } = await supabase
    .from("customers" as any).update(payload as any).eq("id", id).select().single();
  if (error) throw error;
  const row = data as unknown as CustomerRow;
  void logActivity({
    page: "Customers",
    action: "customer_updated",
    entity_type: "customer",
    entity_id: row.id,
    entity_reference: row.guest_name ?? row.phone ?? row.id,
    summary: `Customer updated · ${row.guest_name ?? ""}`,
    after: patch as any,
    source: "manual",
  });
  return row;
}

export async function createCustomer(input: CustomerInput) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  const payload = normalizeCustomerPhones(input);
  const { data, error } = await supabase
    .from("customers" as any)
    .insert({ ...payload, user_id: user.id } as any)
    .select().single();
  if (error) {
    // Duplicate-phone is enforced by partial unique index `customers_phone_unique_when_set`
    if ((error as any).code === "23505" || /customers_phone_unique_when_set|duplicate key/i.test(error.message)) {
      throw new Error(`A customer with phone "${input.phone}" already exists. Please search and use the existing record.`);
    }
    throw error;
  }
  const row = data as unknown as CustomerRow;
  // Seed a Primary customer_phones row so the multi-phone mirror trigger has
  // a primary to sync from. Without this, adding an alternate number later
  // would wipe customers.phone (see tg_customer_phones_sync_primary).
  if (row.phone && String(row.phone).trim() !== "") {
    const { error: phoneErr } = await supabase
      .from("customer_phones" as any)
      .insert({ customer_id: row.id, user_id: user.id, phone: row.phone, is_primary: true, label: "Primary" } as any);
    // Ignore duplicate-phone errors (23505): the number already belongs to
    // another customer_phones row; customers.phone stays as the source of truth.
    if (phoneErr && (phoneErr as any).code !== "23505") {
      console.warn("createCustomer: could not seed primary customer_phones row", phoneErr);
    }
  }
  void logActivity({
    page: "Customers",
    action: "customer_created",
    entity_type: "customer",
    entity_id: row.id,
    entity_reference: row.guest_name ?? row.phone ?? row.id,
    summary: `Customer created · ${row.guest_name ?? ""}${row.phone ? ` · ${row.phone}` : ""}`,
    after: { guest_name: row.guest_name, phone: row.phone, email: row.email },
    source: "manual",
  });
  return row;
}

export async function deleteCustomer(id: string) {
  // Block delete when associated quotes or bookings exist.
  const [q, b] = await Promise.all([
    supabase.from("quotes").select("id", { count: "exact", head: true }).eq("customer_id", id),
    supabase.from("bookings" as any).select("id", { count: "exact", head: true }).eq("customer_id", id),
  ]);
  const qCount = q.count ?? 0;
  const bCount = b.count ?? 0;
  if (qCount > 0 || bCount > 0) {
    throw new Error(
      `Cannot delete customer. Associated records found:\nQuotes: ${qCount}  Bookings: ${bCount}\nPlease delete the associated records first.`,
    );
  }
  const { error } = await supabase.from("customers" as any).delete().eq("id", id);
  if (error) throw error;
}

/**
 * Find existing customer by phone (preferred) or email.
 * UAT-033: also searches the multi-phone table so any registered number
 * resolves to the same customer profile.
 */
export async function findCustomerByContact(phone?: string, email?: string, name?: string) {
  if (!phone && !email) return null;

  // 1. Multi-phone lookup: any registered number resolves to its customer.
  if (phone) {
    const { findCustomerByAnyPhone } = await import("@/lib/customer-phones-api");
    const cid = await findCustomerByAnyPhone(phone);
    if (cid) {
      const { data } = await supabase.from("customers" as any).select("*").eq("id", cid).maybeSingle();
      if (data) return data as unknown as CustomerRow;
    }
  }

  // 2. Legacy path (email + name refinement).
  let q = supabase.from("customers" as any).select("*");
  if (phone && email) {
    q = q.or(`phone.eq.${phone},email.eq.${email}`);
  } else if (phone) {
    q = q.eq("phone", phone);
  } else if (email) {
    q = q.eq("email", email);
  }
  const { data, error } = await q.limit(5);
  if (error) return null;
  const rows = (data ?? []) as unknown as CustomerRow[];
  if (rows.length === 0) return null;
  const lname = (name ?? "").trim().toLowerCase();
  const exact = lname
    ? rows.find(r => (r.guest_name ?? "").trim().toLowerCase() === lname && (!phone || r.phone === phone))
    : undefined;
  return exact ?? rows[0];
}

/** Strict name + phone exact match (used to silently auto-link). */
export async function findCustomerByNameAndPhone(name: string, phone: string) {
  if (!name?.trim() || !phone?.trim()) return null;
  const { data, error } = await supabase
    .from("customers" as any)
    .select("*")
    .eq("phone", phone.trim())
    .ilike("guest_name", name.trim())
    .limit(1);
  if (error) return null;
  return ((data?.[0] as unknown as CustomerRow) ?? null);
}

/** Search customers by partial name OR phone (any registered number) for autocomplete. */
export async function searchCustomers(query: string, limit = 6) {
  const q = query.trim();
  if (q.length < 2) return [];
  const isPhoneish = /^[+0-9 ()-]+$/.test(q);
  let req = supabase.from("customers" as any).select("*");
  if (isPhoneish) {
    // UAT-033: also match alternate numbers via customer_phones.
    const { data: phoneHits } = await supabase
      .from("customer_phones" as any)
      .select("customer_id")
      .ilike("phone", `%${q}%`)
      .limit(limit * 2);
    const ids = Array.from(new Set(((phoneHits ?? []) as any[]).map((r) => r.customer_id).filter(Boolean)));
    if (ids.length > 0) {
      req = supabase.from("customers" as any).select("*").or(`phone.ilike.%${q}%,id.in.(${ids.join(",")})`);
    } else {
      req = req.ilike("phone", `%${q}%`);
    }
  } else {
    req = req.or(`guest_name.ilike.%${q}%,phone.ilike.%${q}%,email.ilike.%${q}%`);
  }
  const { data, error } = await req.order("updated_at", { ascending: false }).limit(limit);
  if (error) return [];
  return (data ?? []) as unknown as CustomerRow[];
}
