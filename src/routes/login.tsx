import { createFileRoute, useNavigate, Navigate } from "@tanstack/react-router";
import { useState } from "react";
import { motion, useReducedMotion, type Variants } from "framer-motion";
import { entranceDelaySeconds } from "@/lib/startup-reveal";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { Loader2, LogIn } from "lucide-react";
import crest from "@/assets/excella-crown-white-complete.webp.asset.json";

function isSameOriginRelative(path: unknown): path is string {
  return typeof path === "string" && path.startsWith("/") && !path.startsWith("//");
}

export const Route = createFileRoute("/login")({
  head: () => ({ meta: [
    { title: "Staff Sign In — Hotel Excella" },
    { name: "description", content: "Secure staff sign in for Hotel Excella operations." },
    { property: "og:title", content: "Staff Sign In — Hotel Excella" },
    { property: "og:description", content: "Secure staff sign in for Hotel Excella operations." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  validateSearch: (s: Record<string, unknown>): { next?: string } => ({
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
  const reduceMotion = useReducedMotion();
  const entranceDelay = entranceDelaySeconds();
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

  const cardVariants: Variants = {
    hidden: { opacity: 0, y: 16, scale: 0.985 },
    show: {
      opacity: 1, y: 0, scale: 1,
      transition: { duration: reduceMotion ? 0 : 0.45, delay: reduceMotion ? 0 : entranceDelay ? 1.45 : 0, ease: [0.22, 1, 0.36, 1] },
    },
  };
  const contentVariants: Variants = {
    hidden: {},
    show: { transition: { staggerChildren: reduceMotion ? 0 : 0.08, delayChildren: reduceMotion ? 0 : entranceDelay ? 0.2 : 0 } },
  };
  const itemVariants: Variants = {
    hidden: { opacity: 0, y: 8 },
    show: { opacity: 1, y: 0, transition: { duration: reduceMotion ? 0 : 0.38, ease: [0.22, 1, 0.36, 1] } },
  };

  return (
    <div className="min-h-screen grain bg-background flex items-center justify-center px-4">
      <motion.div
        variants={cardVariants}
        initial={reduceMotion ? false : "hidden"}
        animate="show"
        className="w-full max-w-md luxe-card rounded-2xl p-8 relative overflow-hidden"
      >
        <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-gold/10 blur-3xl pointer-events-none" />
        <motion.div className="relative" variants={contentVariants}>
          <motion.div className="flex justify-center mb-8" variants={itemVariants}>
            <img src={crest.url} alt="Hotel Excella, Vizag" width={960} height={620} className="login-crown" />
          </motion.div>

          <motion.div variants={itemVariants}>
            <h1 className="font-display text-3xl mb-1">Welcome back</h1>
            <p className="text-sm text-muted-foreground mb-6">
              Sign in with your username.
            </p>
          </motion.div>

          <motion.div variants={itemVariants}>
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
          </motion.div>

          <motion.p className="mt-6 text-center text-[11px] text-muted-foreground" variants={itemVariants}>
            New accounts are created by an administrator.
          </motion.p>
        </motion.div>
      </motion.div>
    </div>
  );
}
