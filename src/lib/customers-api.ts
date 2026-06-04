import { supabase } from "@/integrations/supabase/client";

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

export async function updateCustomer(id: string, patch: Partial<CustomerInput>) {
  const { data, error } = await supabase
    .from("customers" as any).update(patch as any).eq("id", id).select().single();
  if (error) throw error;
  return data as unknown as CustomerRow;
}

export async function createCustomer(input: CustomerInput) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  const { data, error } = await supabase
    .from("customers" as any)
    .insert({ ...input, user_id: user.id } as any)
    .select().single();
  if (error) throw error;
  return data as unknown as CustomerRow;
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

/** Find existing customer by phone or email — used by Generate Quote to surface "Returning Guest". */
export async function findCustomerByContact(phone?: string, email?: string) {
  if (!phone && !email) return null;
  let q = supabase.from("customers" as any).select("*");
  if (phone && email) {
    q = q.or(`phone.eq.${phone},email.eq.${email}`);
  } else if (phone) {
    q = q.eq("phone", phone);
  } else if (email) {
    q = q.eq("email", email);
  }
  const { data, error } = await q.limit(1);
  if (error) return null;
  return (data?.[0] as unknown as CustomerRow) ?? null;
}

/** Search customers by partial name OR phone for autocomplete. */
export async function searchCustomers(query: string, limit = 6) {
  const q = query.trim();
  if (q.length < 2) return [];
  const isPhoneish = /^[+0-9 ()-]+$/.test(q);
  let req = supabase.from("customers" as any).select("*");
  if (isPhoneish) {
    req = req.ilike("phone", `%${q}%`);
  } else {
    req = req.or(`guest_name.ilike.%${q}%,phone.ilike.%${q}%,email.ilike.%${q}%`);
  }
  const { data, error } = await req.order("updated_at", { ascending: false }).limit(limit);
  if (error) return [];
  return (data ?? []) as unknown as CustomerRow[];
}
