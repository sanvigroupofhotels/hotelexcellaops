import { supabase } from "@/integrations/supabase/client";
import type { AppRole } from "@/hooks/use-role";

export interface UserRow {
  id: string;
  email: string | null;
  username: string | null;
  display_name: string | null;
  role: AppRole;
  created_at: string;
}

/** List every staff/admin user with their current role. Admin-only screen. */
export async function listUsers(): Promise<UserRow[]> {
  const [{ data: profiles, error: pErr }, { data: roles, error: rErr }] = await Promise.all([
    supabase.from("profiles").select("id, email, display_name, username, created_at").order("created_at"),
    supabase.from("user_roles").select("user_id, role"),
  ]);
  if (pErr) throw pErr;
  if (rErr) throw rErr;
  const byUser = new Map<string, AppRole>();
  for (const r of roles ?? []) byUser.set((r as any).user_id, (r as any).role);
  return (profiles ?? []).map((p: any) => ({
    id: p.id,
    email: p.email,
    username: p.username ?? null,
    display_name: p.display_name,
    role: byUser.get(p.id) ?? "housekeeping",
    created_at: p.created_at,
  }));
}

/** Replace a user's role with a single new one. Admin-only via RLS. */
export async function setUserRole(userId: string, role: AppRole) {
  const { error: delErr } = await supabase.from("user_roles").delete().eq("user_id", userId);
  if (delErr) throw delErr;
  const { error: insErr } = await supabase
    .from("user_roles")
    .insert({ user_id: userId, role } as any);
  if (insErr) throw insErr;
}
