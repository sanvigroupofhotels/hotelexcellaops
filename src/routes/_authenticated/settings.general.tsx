import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getHotelSettings, setHotelSettings, type HotelSettings } from "@/lib/app-settings-api";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePushNotifications } from "@/hooks/use-push-notifications";

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
    </div>
  );
}

function PushNotificationCard() {
  const { state, supported, requestPermission, unsubscribe } = usePushNotifications();
  const label =
    state === "unsupported" ? "Not supported in this browser" :
    state === "denied" ? "Blocked — enable in browser settings" :
    state === "granted" ? "Enabled on this device" :
    state === "granted-pending" ? "Requesting…" :
    state === "error" ? "Temporarily unavailable" :
    "Not enabled";
  const tone =
    state === "granted" ? "text-emerald-400" :
    state === "denied" || state === "error" || state === "unsupported" ? "text-rose-400" :
    "text-muted-foreground";
  return (
    <Card title="Push Notifications">
      <p className="text-sm text-muted-foreground">
        Receive notifications even when Excella isn't open. In-app notifications keep working regardless.
      </p>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className={cn("text-sm", tone)}>{label}</div>
        <div className="flex items-center gap-2">
          {state !== "granted" && (
            <button
              type="button"
              disabled={!supported || state === "denied" || state === "granted-pending"}
              onClick={() => { requestPermission().catch(() => { /* graceful */ }); }}
              className="px-3 py-1.5 rounded-md bg-gold text-bg-darkest text-xs font-medium disabled:opacity-50"
            >
              Enable on this device
            </button>
          )}
          {state === "granted" && (
            <button
              type="button"
              onClick={() => { unsubscribe().catch(() => { /* graceful */ }); }}
              className="px-3 py-1.5 rounded-md border border-border text-xs"
            >
              Disable
            </button>
          )}
        </div>
      </div>
    </Card>
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
