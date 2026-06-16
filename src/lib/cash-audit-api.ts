import { supabase } from "@/integrations/supabase/client";

export interface CashAuditClose {
  id: string;
  closed_through_date: string;
  closed_by: string | null;
  closed_by_name: string | null;
  closed_at: string;
  reopened_by: string | null;
  reopened_by_name: string | null;
  reopened_at: string | null;
  reopen_reason: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CashAuditActivity {
  id: string;
  audit_close_id: string | null;
  actor_id: string | null;
  actor_name: string | null;
  actor_role: string | null;
  action: "audit_closed" | "audit_reopened" | "audit_closed_again";
  closed_through_date: string | null;
  reason: string | null;
  summary: string | null;
  created_at: string;
}

export async function listCashAuditCloses(): Promise<CashAuditClose[]> {
  const { data, error } = await supabase
    .from("cash_audit_closes" as any)
    .select("*")
    .order("closed_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as CashAuditClose[];
}

export async function getActiveAuditClose(): Promise<CashAuditClose | null> {
  const { data, error } = await supabase
    .from("cash_audit_closes" as any)
    .select("*")
    .eq("active", true)
    .order("closed_through_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as unknown as CashAuditClose | null;
}

export async function createCashAuditClose(closedThroughDate: string): Promise<CashAuditClose> {
  const { data: { user } } = await supabase.auth.getUser();
  const display = (user?.user_metadata as any)?.display_name || user?.email || null;
  // Deactivate any prior active close first
  await supabase.from("cash_audit_closes" as any).update({ active: false } as any).eq("active", true);
  const { data, error } = await supabase
    .from("cash_audit_closes" as any)
    .insert({
      closed_through_date: closedThroughDate,
      closed_by: user?.id ?? null,
      closed_by_name: display,
      active: true,
    } as any)
    .select()
    .single();
  if (error) throw error;
  return data as unknown as CashAuditClose;
}

export async function reopenCashAuditClose(id: string, reason: string): Promise<void> {
  if (!reason?.trim()) throw new Error("Reopen reason is required");
  const { data: { user } } = await supabase.auth.getUser();
  const display = (user?.user_metadata as any)?.display_name || user?.email || null;
  const { error } = await supabase
    .from("cash_audit_closes" as any)
    .update({
      active: false,
      reopened_by: user?.id ?? null,
      reopened_by_name: display,
      reopened_at: new Date().toISOString(),
      reopen_reason: reason.trim(),
    } as any)
    .eq("id", id);
  if (error) throw error;
}

export async function listCashAuditActivities(): Promise<CashAuditActivity[]> {
  const { data, error } = await supabase
    .from("cash_audit_activities" as any)
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data ?? []) as unknown as CashAuditActivity[];
}

/** Check (client-side) whether a tx date is covered by the active audit close. */
export function isTxLocked(occurredAt: string, activeClose: CashAuditClose | null): boolean {
  if (!activeClose) return false;
  // compare YMD in IST
  const d = new Date(occurredAt);
  const ist = new Date(d.getTime() + (330 - d.getTimezoneOffset()) * 60000);
  const ymd = ist.toISOString().slice(0, 10);
  return ymd <= activeClose.closed_through_date;
}
