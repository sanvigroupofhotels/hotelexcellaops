import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";

export type AppRole = "admin" | "staff";

/**
 * Returns the current user's role. Defaults to "staff" while loading or if
 * no role row exists yet. Cached for 5 minutes — change is rare.
 */
export function useUserRole(): { role: AppRole; isAdmin: boolean; isLoading: boolean } {
  const { user } = useAuth();
  const { data, isLoading } = useQuery({
    queryKey: ["user-role", user?.id],
    queryFn: async (): Promise<AppRole> => {
      if (!user) return "staff";
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .order("role", { ascending: true }) // admin sorts before staff
        .limit(1)
        .maybeSingle();
      return ((data as any)?.role as AppRole) ?? "staff";
    },
    enabled: !!user,
    staleTime: 5 * 60_000,
  });
  const role = (data ?? "staff") as AppRole;
  return { role, isAdmin: role === "admin", isLoading };
}
