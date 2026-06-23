import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { logActivity } from "@/lib/activity-log";

interface AuthCtx {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthCtx>({
  user: null,
  session: null,
  loading: true,
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  // Track previous identity to fire login/logout activity transitions only once.
  const lastUserId = useRef<string | null>(null);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      setLoading(false);
      const newId = s?.user?.id ?? null;
      const prev = lastUserId.current;
      // Fire only on real identity transitions; ignore TOKEN_REFRESHED, INITIAL_SESSION
      if (event === "SIGNED_IN" && newId && prev !== newId) {
        void logActivity({
          page: "Auth",
          action: "user_logged_in",
          entity_type: "user",
          entity_id: newId,
          entity_reference: s?.user?.email ?? null,
          summary: `Signed in${s?.user?.email ? ` · ${s.user.email}` : ""}`,
          source: "manual",
        });
      } else if (event === "SIGNED_OUT" && prev) {
        void logActivity({
          page: "Auth",
          action: "user_logged_out",
          entity_type: "user",
          entity_id: prev,
          summary: "Signed out",
          source: "manual",
        });
      }
      lastUserId.current = newId;
    });
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
      lastUserId.current = data.session?.user?.id ?? null;
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  return (
    <Ctx.Provider
      value={{
        user: session?.user ?? null,
        session,
        loading,
        signOut: async () => {
          await supabase.auth.signOut();
        },
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export const useAuth = () => useContext(Ctx);
