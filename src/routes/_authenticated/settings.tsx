import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Topbar } from "@/components/topbar";
import { AdminOnly } from "@/components/admin-only";
import {
  getHotelSettings, setHotelSettings, type HotelSettings,
  getOpsSettings, setOpsSettings, type OpsSettings,
  getBrandingSettings, setBrandingSettings, type BrandingSettings,
} from "@/lib/app-settings-api";
import {
  listIntegrations, createIntegration, updateIntegration, deleteIntegration,
  PROVIDER_LABELS, TYPE_LABELS, STATUS_STYLES,
  type IntegrationProvider, type IntegrationType, type IntegrationRow,
} from "@/lib/integrations-api";
import { Loader2, Plus, Pencil, Trash2, Power, PowerOff, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/settings")({ component: SettingsPage });

const inputCls = "w-full bg-input/60 border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gold/40";
const labelCls = "text-[11px] uppercase tracking-wider text-muted-foreground";

type Tab = "general" | "operations" | "branding" | "integrations";

function SettingsPage() {
  const [tab, setTab] = useState<Tab>("general");
  return (
    <AdminOnly>
      <Topbar title="Settings" subtitle="Configure your hotel, operations, branding and integrations" />
      <div className="px-4 md:px-6 py-5 md:py-8 max-w-[1100px] space-y-5">
        <div className="luxe-card rounded-xl p-2 flex gap-1 overflow-x-auto">
          {(["general", "operations", "branding", "integrations"] as Tab[]).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={cn("shrink-0 px-3 py-2 rounded-md text-xs whitespace-nowrap capitalize",
                tab === t ? "bg-gold-soft text-gold border border-gold/40" : "text-muted-foreground hover:text-foreground")}>
              {t}
            </button>
          ))}
        </div>
        {tab === "general" && <GeneralTab />}
        {tab === "operations" && <OperationsTab />}
        {tab === "branding" && <BrandingTab />}
        {tab === "integrations" && <IntegrationsTab />}
      </div>
    </AdminOnly>
  );
}

// ----- General -----
function GeneralTab() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["hotel-settings"], queryFn: getHotelSettings });
  const [draft, setDraft] = useState<HotelSettings | null>(null);
  useEffect(() => { if (data) setDraft(data); }, [data]);
  const save = useMutation({
    mutationFn: () => setHotelSettings(draft!),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["hotel-settings"] }); toast.success("Saved"); },
    onError: (e: any) => toast.error(e.message),
  });
  if (isLoading || !draft) return <Loading />;
  const f = (k: keyof HotelSettings) => (v: string) => setDraft({ ...draft, [k]: v });
  return (
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
  );
}

// ----- Operations -----
function OperationsTab() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["ops-settings"], queryFn: getOpsSettings });
  const [draft, setDraft] = useState<OpsSettings | null>(null);
  useEffect(() => { if (data) setDraft(data); }, [data]);
  const save = useMutation({
    mutationFn: () => setOpsSettings(draft!),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["ops-settings"] }); toast.success("Saved"); },
    onError: (e: any) => toast.error(e.message),
  });
  if (isLoading || !draft) return <Loading />;
  return (
    <Card title="Operations">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Check-In Time"><input type="time" className={inputCls} value={draft.check_in_time} onChange={(e) => setDraft({ ...draft, check_in_time: e.target.value })} /></Field>
        <Field label="Check-Out Time"><input type="time" className={inputCls} value={draft.check_out_time} onChange={(e) => setDraft({ ...draft, check_out_time: e.target.value })} /></Field>
        <Field label="Currency"><input className={inputCls} value={draft.currency} onChange={(e) => setDraft({ ...draft, currency: e.target.value })} /></Field>
        <Field label="Timezone"><input className={inputCls} value={draft.timezone} onChange={(e) => setDraft({ ...draft, timezone: e.target.value })} /></Field>
      </div>
      <SaveBtn onSave={() => save.mutate()} pending={save.isPending} />
    </Card>
  );
}

// ----- Branding -----
function BrandingTab() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["branding-settings"], queryFn: getBrandingSettings });
  const [draft, setDraft] = useState<BrandingSettings | null>(null);
  useEffect(() => { if (data) setDraft(data); }, [data]);
  const save = useMutation({
    mutationFn: () => setBrandingSettings(draft!),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["branding-settings"] }); toast.success("Saved"); },
    onError: (e: any) => toast.error(e.message),
  });
  if (isLoading || !draft) return <Loading />;
  return (
    <Card title="Branding">
      <Field label="Guest Portal Title"><input className={inputCls} value={draft.portal_title} onChange={(e) => setDraft({ ...draft, portal_title: e.target.value })} /></Field>
      <Field label="Welcome Message"><textarea className={cn(inputCls, "min-h-[80px]")} value={draft.welcome_message} onChange={(e) => setDraft({ ...draft, welcome_message: e.target.value })} /></Field>
      <Field label="Invoice Footer"><textarea className={cn(inputCls, "min-h-[80px]")} value={draft.invoice_footer} onChange={(e) => setDraft({ ...draft, invoice_footer: e.target.value })} /></Field>
      <SaveBtn onSave={() => save.mutate()} pending={save.isPending} />
    </Card>
  );
}

// ----- Integrations -----
function IntegrationsTab() {
  const qc = useQueryClient();
  const { data: rows = [], isLoading } = useQuery({ queryKey: ["integrations"], queryFn: listIntegrations });
  const [openAdd, setOpenAdd] = useState(false);
  const update = useMutation({
    mutationFn: (p: { id: string; patch: any }) => updateIntegration(p.id, p.patch),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["integrations"] }); toast.success("Updated"); },
    onError: (e: any) => toast.error(e.message),
  });
  const del = useMutation({
    mutationFn: deleteIntegration,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["integrations"] }); toast.success("Removed"); },
    onError: (e: any) => toast.error(e.message),
  });

  if (isLoading) return <Loading />;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-display text-lg md:text-xl">External Integrations</h3>
          <p className="text-xs text-muted-foreground">Connect booking sources — bookings flow into House View, Dashboard, Guest Portal automatically.</p>
        </div>
        <button onClick={() => setOpenAdd(true)} className="inline-flex items-center gap-1.5 gold-gradient text-charcoal rounded-md px-4 py-2 text-xs font-medium">
          <Plus className="h-3.5 w-3.5" /> Add Integration
        </button>
      </div>

      {rows.length === 0 && (
        <div className="luxe-card rounded-xl p-8 text-center text-sm text-muted-foreground">
          No integrations yet. Add your first external booking source.
        </div>
      )}
      {rows.map((r) => (
        <IntegrationCard key={r.id} row={r}
          onActivate={() => update.mutate({ id: r.id, patch: { status: "connected" } })}
          onToggle={() => update.mutate({ id: r.id, patch: { status: r.status === "disabled" ? "draft" : "disabled" } })}
          onDelete={() => { if (confirm("Remove this integration?")) del.mutate(r.id); }} />
      ))}

      {openAdd && <AddIntegrationDialog onClose={() => setOpenAdd(false)} />}
    </div>
  );
}

function IntegrationCard({ row, onActivate, onToggle, onDelete }: { row: IntegrationRow; onActivate: () => void; onToggle: () => void; onDelete: () => void }) {
  return (
    <div className="luxe-card rounded-xl p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-display text-base">{row.name}</span>
            <span className={cn("text-[10px] uppercase tracking-wider rounded-full px-2 py-0.5 border", STATUS_STYLES[row.status])}>
              {row.status}
            </span>
          </div>
          <div className="text-[11px] text-muted-foreground mt-1">
            {PROVIDER_LABELS[row.provider]} · {TYPE_LABELS[row.type]}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {(row.status === "draft" || row.status === "disabled") && (
            <button onClick={onActivate} className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider gold-gradient text-charcoal rounded-md px-2.5 py-1 font-medium" title="Activate">
              <CheckCircle2 className="h-3 w-3" /> Activate
            </button>
          )}
          <Link to="/settings/integrations/$id" params={{ id: row.id }} className="p-1.5 rounded hover:bg-accent" title="Edit">
            <Pencil className="h-4 w-4" />
          </Link>
          <button onClick={onToggle} className="p-1.5 rounded hover:bg-accent" title={row.status === "disabled" ? "Enable" : "Disable"}>
            {row.status === "disabled" ? <Power className="h-4 w-4" /> : <PowerOff className="h-4 w-4" />}
          </button>
          <button onClick={onDelete} className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive" title="Delete">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 text-[11px]">
        <div>
          <div className={labelCls}>Last Sync</div>
          <div>{row.last_sync_at ? new Date(row.last_sync_at).toLocaleString("en-IN") : "—"}</div>
        </div>
        <div>
          <div className={labelCls}>Imported</div>
          <div className="stat-num">{row.bookings_imported}</div>
        </div>
        <div>
          <div className={labelCls}>Status Msg</div>
          <div className="truncate" title={row.last_sync_message ?? ""}>{row.last_sync_message ?? "—"}</div>
        </div>
      </div>
    </div>
  );
}

function AddIntegrationDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [type, setType] = useState<IntegrationType>("email_parser");
  const [provider, setProvider] = useState<IntegrationProvider>("fabhotels");

  const create = useMutation({
    mutationFn: () => createIntegration({ name: name.trim(), provider, type }),
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: ["integrations"] });
      toast.success("Integration created");
      onClose();
      navigate({ to: "/settings/integrations/$id", params: { id: row.id } });
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="luxe-card rounded-xl p-5 w-full max-w-md space-y-4" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-display text-lg">Add Integration</h3>
        <Field label="Integration Name">
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. FabHotels Bookings" />
        </Field>
        <Field label="Integration Type">
          <div className="grid grid-cols-2 gap-2">
            {(Object.keys(TYPE_LABELS) as IntegrationType[]).map((t) => (
              <button key={t} onClick={() => setType(t)}
                className={cn("px-3 py-2 rounded-md text-xs border",
                  t === type ? "bg-gold-soft border-gold/40 text-gold" : "border-border text-muted-foreground hover:text-foreground")}>
                {TYPE_LABELS[t]}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Provider">
          <select className={inputCls} value={provider} onChange={(e) => setProvider(e.target.value as IntegrationProvider)}>
            {(Object.keys(PROVIDER_LABELS) as IntegrationProvider[]).map((p) => (
              <option key={p} value={p}>{PROVIDER_LABELS[p]}</option>
            ))}
          </select>
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-4 py-2 text-xs text-muted-foreground hover:text-foreground">Cancel</button>
          <button onClick={() => create.mutate()} disabled={!name.trim() || create.isPending}
            className="inline-flex items-center gap-1.5 gold-gradient text-charcoal rounded-md px-4 py-2 text-xs font-medium disabled:opacity-60">
            {create.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            Create
          </button>
        </div>
      </div>
    </div>
  );
}

// ----- shared bits -----
function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="luxe-card rounded-xl p-5 space-y-4">
      <h3 className="font-display text-lg md:text-xl">{title}</h3>
      {children}
    </div>
  );
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
function Loading() {
  return <div className="luxe-card rounded-xl p-8 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-gold" /></div>;
}
