import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";

/**
 * Application roles — HEOS v1.0 (finalized 2026-07-09, Shipment 3).
 *
 * The four supported roles are:
 *   - admin        — full platform control (user management, masters)
 *   - owner        — read-everything + edit/deactivate any record
 *   - fo_staff     — front-office (reception + hosting)
 *   - housekeeping — cleaning & service task engine
 *
 * The Postgres `app_role` enum still carries historical `reception` and
 * `staff` values purely for schema compatibility with old audit rows; a
 * DB trigger (`user_roles_block_legacy_role`) rejects any new write of
 * those values. The `roles` catalog and `user_roles` table only carry
 * the four active roles. There is no read-time coalescing anymore.
 */
export type AppRole = "admin" | "owner" | "fo_staff" | "housekeeping";

export const ACTIVE_ROLES: readonly AppRole[] = [
  "admin", "owner", "fo_staff", "housekeeping",
] as const;

const RANK: Record<AppRole, number> = { admin: 1, owner: 2, fo_staff: 3, housekeeping: 4 };

export const ROLE_LABEL: Record<AppRole, string> = {
  admin: "Admin",
  owner: "Owner",
  fo_staff: "Front Office",
  housekeeping: "Housekeeping",
};

/** Defensive normalizer for any wire value that ever surfaces (dead audit rows).
 *  Legacy values still map to safe active roles; no user will actually carry them. */
function normalize(role: string | null | undefined): AppRole {
  if (role === "admin" || role === "owner" || role === "fo_staff" || role === "housekeeping") return role;
  if (role === "reception") return "fo_staff";
  if (role === "staff") return "housekeeping";
  return "housekeeping";
}

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
      const roles = ((data ?? []) as any[]).map((r) => normalize(r.role));
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
    isFoStaff: role === "fo_staff",
    isHousekeeping: role === "housekeeping",
    canManage: role === "admin" || role === "owner",
    isLoading,
  };
}
