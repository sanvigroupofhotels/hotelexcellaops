/**
 * Linen Types master — thin CRUD.
 *
 * Editable by admin/owner only (enforced by RLS). Every non-housekeeping
 * write path (linen change on a task) reads the master here and copies
 * `default_qty` + name into the `laundry_queue` row at time of insert, so
 * later master edits never rewrite historical entries.
 */
import { supabase } from "@/integrations/supabase/client";

export interface LinenTypeRow {
  id: string;
  name: string;
  default_qty: number;
  sort_order: number;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export async function listLinenTypes(activeOnly = false): Promise<LinenTypeRow[]> {
  let q = supabase.from("linen_types" as any).select("*").order("sort_order").order("name");
  if (activeOnly) q = q.eq("active", true);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as unknown as LinenTypeRow[];
}

export async function createLinenType(input: { name: string; default_qty?: number; sort_order?: number; active?: boolean; }): Promise<LinenTypeRow> {
  const row = {
    name: input.name.trim(),
    default_qty: Math.max(1, Math.floor(input.default_qty ?? 1)),
    sort_order: input.sort_order ?? 0,
    active: input.active ?? true,
  };
  const { data, error } = await supabase.from("linen_types" as any).insert(row as any).select().single();
  if (error) throw error;
  return data as unknown as LinenTypeRow;
}

export async function updateLinenType(id: string, patch: Partial<Pick<LinenTypeRow, "name" | "default_qty" | "sort_order" | "active">>): Promise<void> {
  const { error } = await supabase.from("linen_types" as any).update(patch as any).eq("id", id);
  if (error) throw error;
}

export async function deleteLinenType(id: string): Promise<void> {
  const { error } = await supabase.from("linen_types" as any).delete().eq("id", id);
  if (error) throw error;
}
