import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";

/**
 * Returns the set of permission keys the current user has, derived from
 * their assigned roles through the role_permissions matrix.
 */
export function usePermissions() {
  const { user } = useAuth();
  const { data, isLoading } = useQuery({
    queryKey: ["my-permissions", user?.id],
    queryFn: async (): Promise<Set<string>> => {
      if (!user) return new Set();
      const { data, error } = await supabase.rpc("my_permissions");
      if (error) return new Set();
      const list = ((data as any[]) ?? []).map((r) => (typeof r === "string" ? r : (r as any).my_permissions));
      return new Set(list.filter(Boolean));
    },
    enabled: !!user,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchInterval: 30_000,
  });
  const set = data ?? new Set<string>();
  return {
    permissions: set,
    has: (key: string) => set.has(key),
    hasAny: (keys: string[]) => keys.some((k) => set.has(k)),
    isLoading,
  };
}
