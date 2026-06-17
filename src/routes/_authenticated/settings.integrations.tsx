import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  listIntegrations, createIntegration, updateIntegration, deleteIntegration,
  PROVIDER_LABELS, TYPE_LABELS, STATUS_STYLES,
  type IntegrationProvider, type IntegrationType, type IntegrationRow,
} from "@/lib/integrations-api";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Loader2, Plus, Pencil, Trash2, Power, PowerOff, CheckCircle2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/settings/integrations")({ component: IntegrationsPage });

const inputCls = "w-full bg-input/60 border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gold/40";
const labelCls = "text-[11px] uppercase tracking-wider text-muted-foreground";

function IntegrationsPage() {
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
  if (isLoading) return <div className="luxe-card rounded-xl p-8 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-gold" /></div>;

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
            <span className={cn("text-[10px] uppercase tracking-wider rounded-full px-2 py-0.5 border", STATUS_STYLES[row.status])}>{row.status}</span>
          </div>
          <div className="text-[11px] text-muted-foreground mt-1">{PROVIDER_LABELS[row.provider]} · {TYPE_LABELS[row.type]}</div>
        </div>
        <div className="flex items-center gap-1">
          {(row.status === "draft" || row.status === "disabled") && (
            <button onClick={onActivate} className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider gold-gradient text-charcoal rounded-md px-2.5 py-1 font-medium" title="Activate">
              <CheckCircle2 className="h-3 w-3" /> Activate
            </button>
          )}
          <Link to="/settings/integrations/$id" params={{ id: row.id }} className="p-1.5 rounded hover:bg-accent" title="Edit"><Pencil className="h-4 w-4" /></Link>
          <button onClick={onToggle} className="p-1.5 rounded hover:bg-accent" title={row.status === "disabled" ? "Enable" : "Disable"}>
            {row.status === "disabled" ? <Power className="h-4 w-4" /> : <PowerOff className="h-4 w-4" />}
          </button>
          <button onClick={onDelete} className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive" title="Delete"><Trash2 className="h-4 w-4" /></button>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 text-[11px]">
        <div><div className={labelCls}>Last Sync</div><div>{row.last_sync_at ? new Date(row.last_sync_at).toLocaleString("en-IN") : "—"}</div></div>
        <div><div className={labelCls}>Imported</div><div className="stat-num">{row.bookings_imported}</div></div>
        <div><div className={labelCls}>Status Msg</div><div className="truncate" title={row.last_sync_message ?? ""}>{row.last_sync_message ?? "—"}</div></div>
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
        <div className="space-y-1.5"><div className={labelCls}>Integration Name</div>
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. FabHotels Bookings" />
        </div>
        <div className="space-y-1.5"><div className={labelCls}>Integration Type</div>
          <div className="grid grid-cols-2 gap-2">
            {(Object.keys(TYPE_LABELS) as IntegrationType[]).map((t) => (
              <button key={t} onClick={() => setType(t)}
                className={cn("px-3 py-2 rounded-md text-xs border",
                  t === type ? "bg-gold-soft border-gold/40 text-gold" : "border-border text-muted-foreground hover:text-foreground")}>
                {TYPE_LABELS[t]}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-1.5"><div className={labelCls}>Provider</div>
          <select className={inputCls} value={provider} onChange={(e) => setProvider(e.target.value as IntegrationProvider)}>
            {(Object.keys(PROVIDER_LABELS) as IntegrationProvider[]).map((p) => <option key={p} value={p}>{PROVIDER_LABELS[p]}</option>)}
          </select>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-4 py-2 text-xs text-muted-foreground hover:text-foreground">Cancel</button>
          <button onClick={() => create.mutate()} disabled={!name.trim() || create.isPending}
            className="inline-flex items-center gap-1.5 gold-gradient text-charcoal rounded-md px-4 py-2 text-xs font-medium disabled:opacity-60">
            {create.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Create
          </button>
        </div>
      </div>
    </div>
  );
}
