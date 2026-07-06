import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";

/**
 * Application roles — post-cleanup (P1 stabilization, 2026-07-05).
 *
 * The only four active roles in HEOS are:
 *   - admin        — full platform control (user management, masters)
 *   - owner        — read-everything + edit/deactivate any record
 *   - fo_staff     — front-office (reception + hosting)
 *   - housekeeping — cleaning & service task engine
 *
 * The Postgres `app_role` enum still contains historical `reception` and
 * `staff` values for schema-compatibility only. As of 2026-07-05 no user
 * carries either legacy role (verified by DB audit) and the migration
 * pipeline `reception → fo_staff`, `staff → housekeeping` has been
 * finalized. Legacy values are intentionally hidden from every UI surface
 * (pickers, matrices, override screens) and are treated as `housekeeping`
 * or `fo_staff` respectively if ever encountered at read-time — see the
 * defensive coalescing in `useUserRole` below.
 */
export type AppRole = "admin" | "owner" | "fo_staff" | "housekeeping";

/**
 * Wire-level role type — includes legacy enum values that may still exist
 * in `public.user_roles`. Kept internal; the app never renders these.
 */
type WireRole = AppRole | "reception" | "staff";

/** UI-facing role list. */
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

/** Coalesce any wire value (including legacy enum values) into the four
 * active roles. Legacy `reception` → `fo_staff`, `staff` → `housekeeping`.
 * Anything else falls back to `housekeeping` (the safest, lowest-privilege
 * mapping). */
function normalize(role: WireRole | string | null | undefined): AppRole {
  switch (role) {
    case "admin":
    case "owner":
    case "fo_staff":
    case "housekeeping":
      return role;
    case "reception":
      return "fo_staff";
    case "staff":
      return "housekeeping";
    default:
      return "housekeeping";
  }
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
