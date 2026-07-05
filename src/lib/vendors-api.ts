import { supabase } from "@/integrations/supabase/client";
import { normalizeOrThrow, normalizePhoneNumber } from "@/lib/phone";

export interface VendorRow {
  id: string;
  name: string;
  contact_person: string;
  phone: string;
  alt_phones: string[];
  address: string | null;
  maps_url: string | null;
  notes: string | null;
  vendor_kind: string[];
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface VendorInput {
  name: string;
  contact_person: string;
  phone: string;
  alt_phones?: string[];
  address?: string | null;
  maps_url?: string | null;
  notes?: string | null;
  vendor_kind?: string[];
  active?: boolean;
}

function clean(input: VendorInput) {
  const name = input.name?.trim();
  const contact_person = input.contact_person?.trim();
  if (!name) throw new Error("Vendor name is required");
  if (!contact_person) throw new Error("Contact person is required");
  const phone = normalizeOrThrow(input.phone);
  const alt_phones = (input.alt_phones ?? [])
    .map((p) => normalizePhoneNumber(p))
    .filter((p) => /^\+91\d{10}$/.test(p));
  const out: Record<string, unknown> = {
    name,
    contact_person,
    phone,
    alt_phones,
    address: input.address?.trim() || null,
    maps_url: input.maps_url?.trim() || null,
    notes: input.notes?.trim() || null,
    active: input.active ?? true,
  };
  if (Array.isArray(input.vendor_kind)) {
    out.vendor_kind = Array.from(new Set(input.vendor_kind.filter(Boolean)));
  }
  return out;
}

export async function listVendors(opts?: { activeOnly?: boolean; kind?: string }): Promise<VendorRow[]> {
  let q = supabase.from("vendors" as any).select("*").order("name");
  if (opts?.activeOnly) q = q.eq("active", true);
  if (opts?.kind) q = q.contains("vendor_kind", [opts.kind]);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as any;
}

export async function getVendor(id: string): Promise<VendorRow | null> {
  const { data, error } = await supabase.from("vendors" as any).select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return (data ?? null) as any;
}

export async function createVendor(input: VendorInput): Promise<VendorRow> {
  const { data: u } = await supabase.auth.getUser();
  const row = { ...clean(input), user_id: u?.user?.id ?? null };
  const { data, error } = await supabase.from("vendors" as any).insert(row).select().single();
  if (error) throw error;
  return data as any;
}

export async function updateVendor(id: string, input: VendorInput): Promise<VendorRow> {
  const { data, error } = await supabase
    .from("vendors" as any).update(clean(input)).eq("id", id).select().single();
  if (error) throw error;
  return data as any;
}

export async function deleteVendor(id: string): Promise<void> {
  const { error } = await supabase.from("vendors" as any).delete().eq("id", id);
  if (error) throw error;
}
