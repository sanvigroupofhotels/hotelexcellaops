import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";

export type AppRole = "admin" | "owner" | "staff";

const RANK: Record<AppRole, number> = { admin: 1, owner: 2, staff: 3 };

/**
 * Returns the current user's role. Defaults to "staff" while loading or if
 * no role row exists yet. Cached for 5 minutes — change is rare.
 *
 * Capability helpers:
 * - isAdmin    → admin only (user mgmt, masters, hard delete)
 * - isOwner    → owner only
 * - canManage  → admin OR owner (edit/deactivate any record, view masters read-only)
 */
export function useUserRole() {
  const { user } = useAuth();
  const { data, isLoading } = useQuery({
    queryKey: ["user-role", user?.id],
    queryFn: async (): Promise<AppRole> => {
      if (!user) return "staff";
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id);
      const roles = ((data ?? []) as any[]).map(r => r.role as AppRole);
      if (roles.length === 0) return "staff";
      // pick highest-privilege role
      return roles.sort((a, b) => RANK[a] - RANK[b])[0] ?? "staff";
    },
    enabled: !!user,
    staleTime: 5 * 60_000,
  });
  const role = (data ?? "staff") as AppRole;
  return {
    role,
    isAdmin: role === "admin",
    isOwner: role === "owner",
    canManage: role === "admin" || role === "owner",
    isLoading,
  };
}
