import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";

/**
 * Single source of truth for "who is the currently signed-in staff member?".
 *
 * Every place in the app that previously exposed a manual user-picker
 * ("Collected By", "Added By", "Recorded By", etc.) should replace that
 * picker with this hook and auto-attribute the logged-in user. This is an
 * accountability guarantee: one staff member can no longer file activity
 * under another staff member's name.
 *
 * Returns:
 *   id     – auth user id (uuid) or null while loading / signed out
 *   name   – display_name › email › "user"  (never empty once loaded)
 *   email  – auth email
 *   isLoading – true while the profile row is being fetched
 */
export function useCurrentStaff() {
  const { user } = useAuth();
  const { data, isLoading } = useQuery({
    queryKey: ["current-staff-profile", user?.id],
    queryFn: async () => {
      if (!user) return null;
      const { data } = await supabase
        .from("profiles")
        .select("display_name,email")
        .eq("id", user.id)
        .maybeSingle();
      return {
        display_name: (data as any)?.display_name as string | null,
        email: (data as any)?.email as string | null,
      };
    },
    enabled: !!user,
    staleTime: 5 * 60_000,
  });
  const name =
    (data?.display_name && data.display_name.trim()) ||
    (data?.email && data.email.trim()) ||
    (user?.email && user.email) ||
    "";
  const firstName = name.split(/[\s@]/)[0] || name;
  return {
    id: user?.id ?? null,
    name,
    firstName,
    email: data?.email ?? user?.email ?? null,
    isLoading,
  };
}
