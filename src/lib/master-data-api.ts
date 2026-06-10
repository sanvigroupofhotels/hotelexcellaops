import { supabase } from "@/integrations/supabase/client";

export type MasterCategory = "lead_source" | "tag";

export interface MasterDataRow {
  id: string;
  category: string;
  value: string;
  label: string;
  sort_order: number;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export async function listMasterData(category?: MasterCategory | string): Promise<MasterDataRow[]> {
  let q = supabase.from("master_data" as any).select("*");
  if (category) q = q.eq("category", category);
  const { data, error } = await q.order("sort_order").order("label");
  if (error) throw error;
  return (data ?? []) as unknown as MasterDataRow[];
}

export async function createMasterData(input: { category: string; value: string; label: string; sort_order?: number; active?: boolean }) {
  const { error } = await supabase.from("master_data" as any).insert(input as any);
  if (error) throw error;
}

export async function updateMasterData(id: string, patch: Partial<Pick<MasterDataRow, "label" | "sort_order" | "active">>) {
  const { error } = await supabase.from("master_data" as any).update(patch as any).eq("id", id);
  if (error) throw error;
}

export async function deleteMasterData(id: string) {
  const { error } = await supabase.from("master_data" as any).delete().eq("id", id);
  if (error) throw error;
}
