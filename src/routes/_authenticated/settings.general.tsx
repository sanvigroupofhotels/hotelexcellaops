import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getHotelSettings, setHotelSettings, type HotelSettings } from "@/lib/app-settings-api";
import { toast } from "sonner";
import { Loader2, CheckCircle2, XCircle, AlertTriangle, Bell, BellRing, Send } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePushNotifications, type PushStatus } from "@/hooks/use-push-notifications";
import { getPushDispatchConfig, configurePushDispatch, sendTestPush } from "@/lib/push-admin.functions";
import { useUserRole } from "@/hooks/use-role";

export const Route = createFileRoute("/_authenticated/settings/general")({ component: GeneralPage });

const inputCls = "w-full bg-input/60 border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gold/40";
const labelCls = "text-[11px] uppercase tracking-wider text-muted-foreground";

function GeneralPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["hotel-settings"], queryFn: getHotelSettings });
  const [draft, setDraft] = useState<HotelSettings | null>(null);
  useEffect(() => { if (data) setDraft(data); }, [data]);
  const save = useMutation({
    mutationFn: () => setHotelSettings(draft!),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["hotel-settings"] }); toast.success("Saved"); },
    onError: (e: any) => toast.error(e.message),
  });
  if (isLoading || !draft) return <Card title="Hotel Details"><Loader /></Card>;
  const f = (k: keyof HotelSettings) => (v: string) => setDraft({ ...draft, [k]: v });
  return (
    <div className="space-y-4">
      <Card title="Hotel Details">
        <Field label="Hotel Name"><input className={inputCls} value={draft.name} onChange={(e) => f("name")(e.target.value)} /></Field>
        <Field label="Logo URL"><input className={inputCls} value={draft.logo_url} onChange={(e) => f("logo_url")(e.target.value)} placeholder="https://…" /></Field>
        <Field label="Address"><textarea className={cn(inputCls, "min-h-[80px]")} value={draft.address} onChange={(e) => f("address")(e.target.value)} /></Field>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="GSTIN"><input className={inputCls} value={draft.gstin} onChange={(e) => f("gstin")(e.target.value)} /></Field>
          <Field label="Contact Number"><input className={inputCls} value={draft.phone} onChange={(e) => f("phone")(e.target.value)} /></Field>
          <Field label="Email"><input className={inputCls} value={draft.email} onChange={(e) => f("email")(e.target.value)} /></Field>
        </div>
        <SaveBtn onSave={() => save.mutate()} pending={save.isPending} />
      </Card>
      <PushNotificationCard />
      <PushDispatchAdminCard />
    </div>
  );
}

/** Human-readable status label + remediation guidance for every PushStatus. */
function statusCopy(s: PushStatus): { label: string; tone: "ok" | "warn" | "bad" | "muted"; help: string | null } {
  switch (s) {
    case "enabled":            return { label: "Push enabled on this device", tone: "ok",   help: null };
    case "checking":           return { label: "Checking browser capability…", tone: "muted", help: null };
    case "requesting":         return { label: "Awaiting browser permission…", tone: "muted", help: "Approve the prompt at the top of your browser window." };
    case "registering_sw":     return { label: "Installing service worker…",   tone: "muted", help: null };
    case "subscribing":        return { label: "Creating push subscription…",  tone: "muted", help: null };
    case "persisting":         return { label: "Saving subscription…",          tone: "muted", help: null };
    case "permission_default": return { label: "Push not enabled yet",         tone: "muted", help: "Click \"Enable on this device\" to receive native notifications." };
    case "permission_denied":  return { label: "Browser permission denied",    tone: "bad",   help: "Click the lock/site-settings icon in your address bar → Notifications → Allow, then reload this page." };
    case "unsupported":        return { label: "Browser unsupported",          tone: "bad",   help: "This browser doesn't support Web Push. Chrome, Edge, Firefox, or Safari 16.4+ are required." };
    case "insecure_context":   return { label: "Requires HTTPS",                tone: "bad",   help: "Push notifications need a secure (https://) connection. Use the published URL." };
    case "sw_failed":          return { label: "Service worker registration failed", tone: "bad", help: "Try a hard reload (Ctrl/Cmd+Shift+R). Private/incognito windows often block service workers." };
    case "subscribe_failed":   return { label: "Subscription creation failed", tone: "bad",   help: "An older subscription may be stuck. Try Disable then Enable again, or clear site data and reload." };
    case "persist_failed":     return { label: "Could not save subscription",  tone: "bad",   help: "Check your internet connection and try again. Sign out and back in if the problem persists." };
    case "vapid_invalid":      return { label: "Administrator configuration required", tone: "bad", help: "VAPID public key is not configured. Notify your administrator." };
    case "unknown_error":      return { label: "Unexpected error",              tone: "bad",   help: "Try again. If it keeps failing, share the error detail with your administrator." };
    case "idle":               return { label: "Initialising…",                 tone: "muted", help: null };
  }
}

function StatusBadge({ status }: { status: PushStatus }) {
  const c = statusCopy(status);
  const Icon = c.tone === "ok" ? CheckCircle2 : c.tone === "bad" ? XCircle : AlertTriangle;
  const toneCls =
    c.tone === "ok" ? "text-emerald-400" :
    c.tone === "bad" ? "text-rose-400" :
    c.tone === "warn" ? "text-amber-400" :
    "text-muted-foreground";
  return (
    <div className={cn("flex items-center gap-1.5 text-sm", toneCls)}>
      <Icon className="h-4 w-4 flex-shrink-0" />
      <span>{c.label}</span>
    </div>
  );
}

function PushNotificationCard() {
  const { diag, enable, disable, refresh } = usePushNotifications();
  const help = statusCopy(diag.status).help;
  const busy = diag.status === "checking" || diag.status === "requesting" || diag.status === "registering_sw" || diag.status === "subscribing" || diag.status === "persisting";
  const enableDisabled = busy || diag.status === "enabled" || diag.status === "unsupported" || diag.status === "insecure_context" || diag.status === "permission_denied" || diag.status === "vapid_invalid";

  return (
    <Card title="Push Notifications">
      <p className="text-sm text-muted-foreground">
        Receive notifications even when Excella isn't open. In-app notifications keep working regardless.
      </p>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="space-y-1.5 flex-1 min-w-[200px]">
          <StatusBadge status={diag.status} />
          {help && <div className="text-[11px] text-muted-foreground max-w-[420px]">{help}</div>}
          {diag.errorDetail && (
            <div className="text-[10px] font-mono text-rose-300/80 max-w-[420px] break-words bg-rose-500/5 border border-rose-500/20 rounded px-2 py-1">
              {diag.errorDetail}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {diag.status !== "enabled" && (
            <button
              type="button"
              disabled={enableDisabled}
              onClick={() => {
                enable().then((res) => {
                  if (res === "enabled") toast.success("Push notifications enabled");
                  else if (res === "permission_denied") toast.error("Browser permission denied");
                }).catch((e: any) => toast.error(e?.message ?? "Push setup failed"));
              }}
              className="px-3 py-1.5 rounded-md bg-gold text-bg-darkest text-xs font-medium disabled:opacity-50 inline-flex items-center gap-1.5"
            >
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Bell className="h-3 w-3" />}
              Enable on this device
            </button>
          )}
          {diag.status === "enabled" && (
            <button
              type="button"
              onClick={() => { disable().then(() => toast.success("Push disabled on this device")).catch(() => { /* graceful */ }); }}
              className="px-3 py-1.5 rounded-md border border-border text-xs"
            >
              Disable
            </button>
          )}
          <button
            type="button"
            onClick={() => { refresh().catch(() => { /* noop */ }); }}
            className="px-2 py-1.5 rounded-md border border-border text-[11px] text-muted-foreground hover:text-foreground"
          >
            Re-check
          </button>
        </div>
      </div>

      {/* Diagnostics — collapsed by default */}
      <details className="rounded-md border border-border/60 bg-muted/10 px-3 py-2 text-[11px]">
        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Diagnostics</summary>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-2 font-mono">
          <DiagRow label="Permission" value={diag.permission} />
          <DiagRow label="Secure context" value={String(diag.secureContext)} />
          <DiagRow label="ServiceWorker" value={String(diag.hasServiceWorker)} />
          <DiagRow label="PushManager" value={String(diag.hasPushManager)} />
          <DiagRow label="Notification API" value={String(diag.hasNotification)} />
          <DiagRow label="VAPID key" value={diag.vapidKeyPresent ? "present" : "missing"} />
          <DiagRow label="SW scope" value={diag.swScope ?? "—"} />
          <DiagRow label="Endpoint" value={diag.subscriptionEndpoint ? diag.subscriptionEndpoint.slice(0, 48) + "…" : "—"} />
        </div>
      </details>
    </Card>
  );
}

function DiagRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <span className="text-muted-foreground">{label}</span>
      <span className="truncate">{value}</span>
    </>
  );
}

/** Admin-only card to configure & test the Push dispatch trigger. */
function PushDispatchAdminCard() {
  const { canManage: isAdmin } = useUserRole();
  const cfg = useServerFn(getPushDispatchConfig);
  const configure = useServerFn(configurePushDispatch);
  const test = useServerFn(sendTestPush);
  const qc = useQueryClient();
  const { data: status, isLoading } = useQuery({
    queryKey: ["push-dispatch-config"],
    queryFn: () => cfg(),
    enabled: isAdmin,
  });
  const configureM = useMutation({
    mutationFn: () => configure({ data: { origin: window.location.origin } }),
    onSuccess: (d: any) => {
      toast.success(`Push dispatch configured · ${d.push_dispatch_url}`);
      qc.invalidateQueries({ queryKey: ["push-dispatch-config"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to configure push dispatch"),
  });
  const testM = useMutation({
    mutationFn: () => test(),
    onSuccess: () => toast.success("Test notification dispatched — check the bell and your device"),
    onError: (e: any) => toast.error(e?.message ?? "Failed to send test"),
  });

  if (!isAdmin) return null;

  return (
    <Card title="Push Dispatch (Admin)">
      <p className="text-sm text-muted-foreground">
        Configures the server-side dispatcher that fans out Web Push deliveries when notifications are created. One-time per environment.
      </p>
      {isLoading ? <Loader /> : (
        <div className="space-y-2 text-[12px]">
          <StatusLine label="Dispatch URL" ok={Boolean(status?.push_dispatch_url)} detail={status?.push_dispatch_url || "not set"} />
          <StatusLine label="Dispatch secret matches env" ok={Boolean(status?.secret_matches_env)} detail={status?.push_dispatch_secret_present ? (status?.secret_matches_env ? "ok" : "drift — re-run configure") : "not set"} />
          <StatusLine label="Server VAPID keys" ok={Boolean(status?.env_vapid_private_present && status?.env_vapid_public_present)} detail={status?.env_vapid_subject ?? "—"} />
        </div>
      )}
      <div className="flex flex-wrap gap-2 pt-1">
        <button
          type="button"
          onClick={() => configureM.mutate()}
          disabled={configureM.isPending}
          className="inline-flex items-center gap-1.5 rounded-md border border-gold/40 bg-gold-soft/40 text-foreground px-3 py-1.5 text-xs font-medium hover:bg-gold-soft/60 disabled:opacity-60"
        >
          {configureM.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
          <BellRing className="h-3 w-3" />
          Auto-configure dispatcher
        </button>
        <button
          type="button"
          onClick={() => testM.mutate()}
          disabled={testM.isPending}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs hover:border-gold/40 disabled:opacity-60"
        >
          {testM.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
          <Send className="h-3 w-3" />
          Send test notification
        </button>
      </div>
    </Card>
  );
}

function StatusLine({ label, ok, detail }: { label: string; ok: boolean; detail: string }) {
  const Icon = ok ? CheckCircle2 : XCircle;
  return (
    <div className="flex items-start justify-between gap-2 border-b border-border/40 pb-1.5">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("inline-flex items-center gap-1 text-right font-mono break-all", ok ? "text-emerald-400" : "text-rose-400")}>
        <Icon className="h-3 w-3 flex-shrink-0" /> <span className="truncate max-w-[260px]">{detail}</span>
      </span>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="luxe-card rounded-xl p-5 space-y-4"><h3 className="font-display text-lg md:text-xl">{title}</h3>{children}</div>;
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (<div className="space-y-1.5"><div className={labelCls}>{label}</div>{children}</div>);
}
function SaveBtn({ onSave, pending }: { onSave: () => void; pending: boolean }) {
  return (
    <div className="flex justify-end pt-2">
      <button onClick={onSave} disabled={pending}
        className="inline-flex items-center gap-1.5 gold-gradient text-charcoal rounded-md px-5 py-2 text-xs font-medium disabled:opacity-60">
        {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save
      </button>
    </div>
  );
}
function Loader() { return <div className="flex justify-center p-8"><Loader2 className="h-5 w-5 animate-spin text-gold" /></div>; }
