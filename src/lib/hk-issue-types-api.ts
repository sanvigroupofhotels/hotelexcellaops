/**
 * Housekeeping Issue Types master — thin CRUD.
 *
 * Each issue type can carry a `default_complaint_category_id`. When a
 * housekeeping task submits an issue, `hk-tasks.completeTask` uses that
 * mapping to file a Complaint (best-effort — see design §4.2 / C9).
 */
import { supabase } from "@/integrations/supabase/client";

export interface HkIssueTypeRow {
  id: string;
  label: string;
  sort_order: number;
  active: boolean;
  default_complaint_category_id: string | null;
  created_at: string;
  updated_at: string;
}

export async function listHkIssueTypes(activeOnly = false): Promise<HkIssueTypeRow[]> {
  let q = supabase.from("hk_issue_types" as any).select("*").order("sort_order").order("label");
  if (activeOnly) q = q.eq("active", true);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as unknown as HkIssueTypeRow[];
}

export async function createHkIssueType(input: { label: string; sort_order?: number; active?: boolean; default_complaint_category_id?: string | null }): Promise<HkIssueTypeRow> {
  const row = {
    label: input.label.trim(),
    sort_order: input.sort_order ?? 0,
    active: input.active ?? true,
    default_complaint_category_id: input.default_complaint_category_id ?? null,
  };
  const { data, error } = await supabase.from("hk_issue_types" as any).insert(row as any).select().single();
  if (error) throw error;
  return data as unknown as HkIssueTypeRow;
}

export async function updateHkIssueType(id: string, patch: Partial<Pick<HkIssueTypeRow, "label" | "sort_order" | "active" | "default_complaint_category_id">>): Promise<void> {
  const { error } = await supabase.from("hk_issue_types" as any).update(patch as any).eq("id", id);
  if (error) throw error;
}

export async function deleteHkIssueType(id: string): Promise<void> {
  const { error } = await supabase.from("hk_issue_types" as any).delete().eq("id", id);
  if (error) throw error;
}
