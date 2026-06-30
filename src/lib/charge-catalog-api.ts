import { supabase } from "@/integrations/supabase/client";

export interface ChargeCatalogRow {
  id: string;
  key: string;
  label: string;
  default_price: number;
  taxable: boolean;
  sort_order: number;
  active: boolean;
  inventory_item_id: string | null;
  auto_consume_qty: number;
  created_at: string;
  updated_at: string;
}

export interface ChargeCatalogInput {
  key: string;
  label: string;
  default_price?: number;
  taxable?: boolean;
  sort_order?: number;
  active?: boolean;
  inventory_item_id?: string | null;
  auto_consume_qty?: number;
}

function slugify(s: string) {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

export async function listChargeCatalog(opts?: { activeOnly?: boolean }): Promise<ChargeCatalogRow[]> {
  let q = supabase.from("charge_catalog" as any).select("*").order("sort_order").order("label");
  if (opts?.activeOnly) q = q.eq("active", true);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as any;
}

export async function createChargeCatalog(input: ChargeCatalogInput): Promise<ChargeCatalogRow> {
  const label = input.label?.trim();
  if (!label) throw new Error("Label is required");
  const key = input.key?.trim() || slugify(label);
  if (!key) throw new Error("Key is required");
  const { data: u } = await supabase.auth.getUser();
  const row = {
    key,
    label,
    default_price: input.default_price ?? 0,
    taxable: input.taxable ?? false,
    sort_order: input.sort_order ?? 100,
    active: input.active ?? true,
    user_id: u?.user?.id ?? null,
  };
  const { data, error } = await supabase.from("charge_catalog" as any).insert(row).select().single();
  if (error) throw error;
  return data as any;
}

export async function updateChargeCatalog(id: string, patch: Partial<ChargeCatalogInput>): Promise<void> {
  const next: any = { ...patch };
  if (patch.label != null) next.label = patch.label.trim();
  const { error } = await supabase.from("charge_catalog" as any).update(next).eq("id", id);
  if (error) throw error;
}

export async function deleteChargeCatalog(id: string): Promise<void> {
  const { error } = await supabase.from("charge_catalog" as any).delete().eq("id", id);
  if (error) throw error;
}
