import { createFileRoute, useNavigate, Navigate } from "@tanstack/react-router";
import { useState } from "react";
import { motion } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { Loader2, LogIn } from "lucide-react";

function isSameOriginRelative(path: unknown): path is string {
  return typeof path === "string" && path.startsWith("/") && !path.startsWith("//");
}

export const Route = createFileRoute("/login")({
  validateSearch: (s: Record<string, unknown>) => ({
    next: isSameOriginRelative(s.next) ? (s.next as string) : undefined,
  }),
  component: LoginPage,
});

const SYNTH_EMAIL_DOMAIN = "hotelexcella.in";

/**
 * Sign in by username OR email.
 *   - Contains "@" → treat as email, sign in directly.
 *   - No "@"       → look the username up via `resolve_username_to_email`
 *                    RPC (SECURITY DEFINER). Falls back to
 *                    `<username>@hotelexcella.in` if no match exists (covers
 *                    newly-created users where the synthesized email was set).
 */
async function signInWithIdentifier(identifier: string, password: string) {
  const id = identifier.trim();
  if (id.includes("@")) {
    return supabase.auth.signInWithPassword({ email: id, password });
  }
  let email: string | null = null;
  try {
    const { data } = await supabase.rpc("resolve_username_to_email" as any, { _username: id } as any);
    if (typeof data === "string" && data.length > 0) email = data;
  } catch {
    /* ignore — fall back to synthesized email */
  }
  return supabase.auth.signInWithPassword({
    email: email ?? `${id.toLowerCase()}@${SYNTH_EMAIL_DOMAIN}`,
    password,
  });
}

function LoginPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const { next } = Route.useSearch();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  if (!loading && user) {
    if (next && isSameOriginRelative(next)) {
      window.location.replace(next);
      return null;
    }
    return <Navigate to="/" />;
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { error } = await signInWithIdentifier(identifier, password);
      if (error) throw error;
      toast.success("Welcome back");
      if (next && isSameOriginRelative(next)) {
        window.location.replace(next);
        return;
      }
      navigate({ to: "/" });
    } catch (err: any) {
      toast.error(err.message ?? "Authentication failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen grain bg-background flex items-center justify-center px-4">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-md luxe-card rounded-2xl p-8 relative overflow-hidden"
      >
        <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-gold/10 blur-3xl pointer-events-none" />
        <div className="relative">
          <div className="flex items-center gap-3 mb-8">
            <div className="h-12 w-12 rounded-md gold-gradient flex items-center justify-center">
              <span className="font-display text-xl text-charcoal">H</span>
            </div>
            <div>
              <div className="font-display text-lg">HOTEL EXCELLA</div>
              <div className="text-[10px] tracking-[0.3em] text-gold/80 uppercase">
                Reservations OS
              </div>
            </div>
          </div>

          <h1 className="font-display text-3xl mb-1">Welcome back</h1>
          <p className="text-sm text-muted-foreground mb-6">
            Sign in with your username.
          </p>

          <form onSubmit={submit} className="space-y-3">
            <div>
              <label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Username
              </label>
              <input
                type="text"
                required
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                className="mt-1 w-full bg-input/60 border border-border rounded-md px-3 py-2.5 text-sm focus:ring-2 focus:ring-gold/40 focus:border-gold/50 outline-none"
              />
            </div>
            <div>
              <label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Password
              </label>
              <input
                type="password"
                required
                minLength={6}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 w-full bg-input/60 border border-border rounded-md px-3 py-2.5 text-sm focus:ring-2 focus:ring-gold/40 focus:border-gold/50 outline-none"
              />
            </div>

            <button
              type="submit"
              disabled={busy}
              className="w-full mt-4 inline-flex items-center justify-center gap-2 rounded-md gold-gradient px-4 py-3 text-sm font-medium text-charcoal hover:shadow-[0_0_24px_oklch(0.82_0.13_82/0.35)] transition disabled:opacity-60"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
              Sign in
            </button>
          </form>

          <p className="mt-6 text-center text-[11px] text-muted-foreground">
            New accounts are created by an administrator.
          </p>
        </div>
      </motion.div>
    </div>
  );
}
