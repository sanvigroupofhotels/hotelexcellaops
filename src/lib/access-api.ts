import { supabase } from "@/integrations/supabase/client";

export interface Role {
  id: string;
  key: string;
  label: string;
  description: string | null;
  is_system: boolean;
  sort_order: number;
}
export interface Permission {
  id: string;
  module: string;
  key: string;
  label: string;
  description: string | null;
  sort_order: number;
}
export interface RolePermission {
  role_key: string;
  permission_key: string;
}

export async function listRoles(): Promise<Role[]> {
  const { data, error } = await supabase
    .from("roles" as any)
    .select("*")
    .order("sort_order");
  if (error) throw error;
  return (data ?? []) as any;
}

export async function listPermissions(): Promise<Permission[]> {
  const { data, error } = await supabase
    .from("permissions" as any)
    .select("*")
    .order("sort_order");
  if (error) throw error;
  return (data ?? []) as any;
}

export async function listRolePermissions(): Promise<RolePermission[]> {
  const { data, error } = await supabase
    .from("role_permissions" as any)
    .select("role_key, permission_key");
  if (error) throw error;
  return (data ?? []) as any;
}

export async function togglePermission(
  role_key: string,
  permission_key: string,
  granted: boolean,
) {
  if (granted) {
    const { error } = await supabase
      .from("role_permissions" as any)
      .insert({ role_key, permission_key } as any);
    if (error && !(error as any).message?.includes("duplicate")) throw error;
  } else {
    const { error } = await supabase
      .from("role_permissions" as any)
      .delete()
      .eq("role_key", role_key)
      .eq("permission_key", permission_key);
    if (error) throw error;
  }
}

export async function createRole(input: { key: string; label: string; description?: string }) {
  const { data, error } = await supabase
    .from("roles" as any)
    .insert({
      key: input.key,
      label: input.label,
      description: input.description ?? null,
      is_system: false,
      sort_order: 500,
    } as any)
    .select()
    .single();
  if (error) throw error;
  return data as any;
}

export async function updateRole(id: string, patch: { label?: string; description?: string }) {
  const { error } = await supabase
    .from("roles" as any)
    .update(patch as any)
    .eq("id", id);
  if (error) throw error;
}

export async function deleteRole(id: string) {
  const { error } = await supabase.from("roles" as any).delete().eq("id", id);
  if (error) throw error;
}

/* ============================================================
   Per-user permission overrides
   ============================================================ */

export interface UserPermissionOverride {
  id: string;
  user_id: string;
  permission_key: string;
  granted: boolean;
  expires_at: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** All overrides (admin view). RLS allows admins to read every row. */
export async function listAllUserOverrides(): Promise<UserPermissionOverride[]> {
  const { data, error } = await supabase
    .from("user_permission_overrides" as any)
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as any;
}

export async function listUserOverrides(user_id: string): Promise<UserPermissionOverride[]> {
  const { data, error } = await supabase
    .from("user_permission_overrides" as any)
    .select("*")
    .eq("user_id", user_id);
  if (error) throw error;
  return (data ?? []) as any;
}

/** Upsert a single override (grant or deny). expires_at: ISO string or null. */
export async function setUserOverride(input: {
  user_id: string;
  permission_key: string;
  granted: boolean;
  expires_at?: string | null;
  notes?: string | null;
}) {
  const { error } = await supabase
    .from("user_permission_overrides" as any)
    .upsert(
      {
        user_id: input.user_id,
        permission_key: input.permission_key,
        granted: input.granted,
        expires_at: input.expires_at ?? null,
        notes: input.notes ?? null,
      } as any,
      { onConflict: "user_id,permission_key" },
    );
  if (error) throw error;
}

/** Remove an override entirely (back to role-inherited default). */
export async function clearUserOverride(user_id: string, permission_key: string) {
  const { error } = await supabase
    .from("user_permission_overrides" as any)
    .delete()
    .eq("user_id", user_id)
    .eq("permission_key", permission_key);
  if (error) throw error;
}

/** Compute the permission set a given user effectively has (role ∪ grants − denies). */
export async function getUserEffectivePermissions(user_id: string): Promise<Set<string>> {
  const { data, error } = await supabase.rpc("user_effective_permissions" as any, { _user_id: user_id } as any);
  if (error) throw error;
  const list = ((data as any[]) ?? []).map((r) => (typeof r === "string" ? r : r.permission_key));
  return new Set(list.filter(Boolean));
}
