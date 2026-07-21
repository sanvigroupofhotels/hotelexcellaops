import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";

type AuthorizationDetails = {
  client?: { name?: string; client_uri?: string } | null;
  redirect_uri?: string | null;
  scope?: string | null;
  scopes?: string[] | null;
  redirect_url?: string | null;
  redirect_to?: string | null;
};

// The Supabase JS `auth.oauth` namespace is beta; provide a narrow typed wrapper
// rather than reach into node_modules or call raw /oauth/authorizations endpoints.
const oauth = (supabase.auth as any).oauth as {
  getAuthorizationDetails(id: string): Promise<{ data: AuthorizationDetails | null; error: any }>;
  approveAuthorization(id: string): Promise<{ data: AuthorizationDetails | null; error: any }>;
  denyAuthorization(id: string): Promise<{ data: AuthorizationDetails | null; error: any }>;
};

function isSameOriginRelative(path: string) {
  return typeof path === "string" && path.startsWith("/") && !path.startsWith("//");
}

export const Route = createFileRoute("/.lovable/oauth/consent")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>) => ({
    authorization_id: typeof s.authorization_id === "string" ? s.authorization_id : "",
  }),
  beforeLoad: async ({ search, location }) => {
    if (!search.authorization_id) throw new Error("Missing authorization_id");
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      const next = location.pathname + location.searchStr;
      throw redirect({ to: "/login", search: { next } as any });
    }
  },
  loader: async ({ location }) => {
    const authorizationId = new URLSearchParams(location.search).get("authorization_id")!;
    const { data, error } = await oauth.getAuthorizationDetails(authorizationId);
    if (error) throw error;
    const immediate = data?.redirect_url ?? data?.redirect_to;
    if (immediate && !data?.client) {
      throw redirect({ href: immediate } as any);
    }
    return data;
  },
  component: Consent,
  errorComponent: ({ error }) => (
    <main className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="luxe-card rounded-2xl p-8 max-w-md">
        <h1 className="font-display text-2xl mb-2">Authorization error</h1>
        <p className="text-sm text-muted-foreground">
          Could not load this authorization request: {String((error as Error)?.message ?? error)}
        </p>
      </div>
    </main>
  ),
});

function Consent() {
  const details = Route.useLoaderData() as AuthorizationDetails | null;
  const { authorization_id } = Route.useSearch();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clientName = details?.client?.name ?? "an app";
  const scopes =
    details?.scopes ??
    (typeof details?.scope === "string" && details.scope.length
      ? details.scope.split(/\s+/)
      : []);

  async function decide(approve: boolean) {
    setBusy(true);
    setError(null);
    const { data, error } = approve
      ? await oauth.approveAuthorization(authorization_id)
      : await oauth.denyAuthorization(authorization_id);
    if (error) {
      setBusy(false);
      setError(error.message ?? "Something went wrong.");
      return;
    }
    const target = data?.redirect_url ?? data?.redirect_to;
    if (!target) {
      setBusy(false);
      setError("No redirect returned by the authorization server.");
      return;
    }
    window.location.href = target;
  }

  return (
    <main className="min-h-screen bg-background flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md luxe-card rounded-2xl p-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="h-10 w-10 rounded-md gold-gradient flex items-center justify-center">
            <span className="font-display text-lg text-charcoal">H</span>
          </div>
          <div>
            <div className="font-display text-base">HOTEL EXCELLA</div>
            <div className="text-[10px] tracking-[0.3em] text-gold/80 uppercase">
              Reservations OS
            </div>
          </div>
        </div>

        <h1 className="font-display text-2xl mb-1">
          Connect {clientName} to Hotel Excella
        </h1>
        <p className="text-sm text-muted-foreground mb-4">
          This lets {clientName} use Hotel Excella as you. It can only see and do
          what your account is already allowed to.
        </p>

        {scopes.length > 0 && (
          <div className="mb-4">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">
              Requested access
            </div>
            <ul className="text-sm list-disc list-inside space-y-0.5">
              {scopes.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </div>
        )}

        <p className="text-xs text-muted-foreground mb-6">
          This does not bypass Hotel Excella's permissions or backend policies.
        </p>

        {error && (
          <p role="alert" className="text-sm text-destructive mb-3">
            {error}
          </p>
        )}

        <div className="flex gap-2">
          <button
            disabled={busy}
            onClick={() => decide(true)}
            className="flex-1 rounded-md gold-gradient px-4 py-3 text-sm font-medium text-charcoal hover:shadow-[0_0_24px_oklch(0.82_0.13_82/0.35)] transition disabled:opacity-60"
          >
            Approve
          </button>
          <button
            disabled={busy}
            onClick={() => decide(false)}
            className="flex-1 rounded-md border border-border bg-input/60 px-4 py-3 text-sm hover:bg-input transition disabled:opacity-60"
          >
            Cancel
          </button>
        </div>
      </div>
    </main>
  );
}

// keep isSameOriginRelative referenced (used by consumers of the module in tests)
export { isSameOriginRelative };
