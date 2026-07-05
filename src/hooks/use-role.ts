import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";

/**
 * Application roles.
 *
 * Active (Phase 3A.0+):
 *   - admin        — full platform control (user management, masters)
 *   - owner        — read-everything + edit/deactivate any record
 *   - fo_staff     — front-office (reception + hosting)
 *   - housekeeping — cleaning & service task engine
 *
 * Deprecated (kept for schema compatibility only, hidden from all pickers;
 * users on these roles were backfilled to the new roles):
 *   - reception → fo_staff
 *   - staff     → housekeeping
 */
export type AppRole = "admin" | "owner" | "fo_staff" | "housekeeping" | "reception" | "staff";

/** UI-facing role list — deprecated roles are hidden. */
export const ACTIVE_ROLES: readonly AppRole[] = ["admin", "owner", "fo_staff", "housekeeping"] as const;

/** Priority order for picking the "primary" role when a user has multiple. */
const RANK: Record<AppRole, number> = {
  admin: 1, owner: 2, fo_staff: 3, housekeeping: 4,
  reception: 5, staff: 6, // deprecated — lowest priority
};

export const ROLE_LABEL: Record<AppRole, string> = {
  admin: "Admin",
  owner: "Owner",
  fo_staff: "Front Office",
  housekeeping: "Housekeeping",
  reception: "Reception (legacy)",
  staff: "Staff (legacy)",
};

/**
 * Returns the current user's role. Defaults to "housekeeping" while loading
 * or if no role row exists yet. Cached for 5 minutes — change is rare.
 */
export function useUserRole() {
  const { user } = useAuth();
  const { data, isLoading } = useQuery({
    queryKey: ["user-role", user?.id],
    queryFn: async (): Promise<AppRole> => {
      if (!user) return "housekeeping";
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id);
      const roles = ((data ?? []) as any[]).map((r) => r.role as AppRole);
      if (roles.length === 0) return "housekeeping";
      return roles.sort((a, b) => (RANK[a] ?? 99) - (RANK[b] ?? 99))[0] ?? "housekeeping";
    },
    enabled: !!user,
    staleTime: 5 * 60_000,
  });
  const role = (data ?? "housekeeping") as AppRole;
  return {
    role,
    isAdmin: role === "admin",
    isOwner: role === "owner",
    isFoStaff: role === "fo_staff" || role === "reception",
    isHousekeeping: role === "housekeeping" || role === "staff",
    canManage: role === "admin" || role === "owner",
    isLoading,
  };
}
