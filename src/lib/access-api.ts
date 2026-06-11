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
