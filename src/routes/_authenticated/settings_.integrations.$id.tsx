import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Topbar } from "@/components/topbar";
import { AdminOnly } from "@/components/admin-only";
import {
  getIntegration, updateIntegration, listIntegrationRuns,
  PROVIDER_LABELS, TYPE_LABELS, STATUS_STYLES,
  type IntegrationRow, type IntegrationStatus,
} from "@/lib/integrations-api";
import { ArrowLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/settings_/integrations/$id")({
  component: IntegrationDetailPage,
});

const inputCls = "w-full bg-input/60 border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gold/40";
const labelCls = "text-[11px] uppercase tracking-wider text-muted-foreground";

function IntegrationDetailPage() {
  const { id } = useParams({ from: "/_authenticated/settings_/integrations/$id" });
  return (
    <AdminOnly>
      <Topbar title="Integration" subtitle="Configure provider and view sync history" />
      <Content id={id} />
    </AdminOnly>
  );
}

function Content({ id }: { id: string }) {
  const qc = useQueryClient();
  const { data: row, isLoading } = useQuery({ queryKey: ["integration", id], queryFn: () => getIntegration(id) });
  const { data: runs = [] } = useQuery({ queryKey: ["integration-runs", id], queryFn: () => listIntegrationRuns(id) });
  const [name, setName] = useState("");
  const [status, setStatus] = useState<IntegrationStatus>("draft");
  const [configText, setConfigText] = useState("{}");
  const [configErr, setConfigErr] = useState<string | null>(null);

  useEffect(() => {
    if (row) {
      setName(row.name);
      setStatus(row.status);
      setConfigText(JSON.stringify(row.config ?? {}, null, 2));
    }
  }, [row]);

  const save = useMutation({
    mutationFn: () => {
      let cfg: any = {};
      try { cfg = JSON.parse(configText || "{}"); }
      catch (e: any) { setConfigErr(e.message); throw new Error("Config JSON is invalid"); }
      setConfigErr(null);
      return updateIntegration(id, { name, status, config: cfg });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["integration", id] }); toast.success("Saved"); },
    onError: (e: any) => toast.error(e.message),
  });

  if (isLoading || !row) return <div className="p-8"><Loader2 className="h-5 w-5 animate-spin text-gold" /></div>;

  return (
    <div className="px-4 md:px-6 py-5 md:py-8 max-w-[1100px] space-y-5">
      <Link to="/settings" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to Settings
      </Link>

      <div className="luxe-card rounded-xl p-5 space-y-4">
        <div className="flex items-baseline justify-between gap-2 flex-wrap">
          <h3 className="font-display text-xl">{PROVIDER_LABELS[row.provider]}</h3>
          <span className="text-[11px] text-muted-foreground">{TYPE_LABELS[row.type]}</span>
        </div>

        <Field label="Name"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} /></Field>

        <Field label="Status">
          <select className={inputCls} value={status} onChange={(e) => setStatus(e.target.value as IntegrationStatus)}>
            <option value="draft">Draft</option>
            <option value="connected">Connected</option>
            <option value="disabled">Disabled</option>
            <option value="error">Error</option>
          </select>
        </Field>

        <Field label="Configuration (JSON)">
          <textarea className={cn(inputCls, "font-mono text-[11px] min-h-[200px]")} value={configText}
            onChange={(e) => setConfigText(e.target.value)} spellCheck={false} />
          {configErr && <div className="text-[11px] text-destructive">{configErr}</div>}
          <ConfigHint type={row.type} />
        </Field>

        <div className="flex flex-wrap gap-2 justify-end pt-2">
          {row.provider === "hotelzify" && (
            <button onClick={() => runSync.mutate()} disabled={runSync.isPending}
              className="inline-flex items-center gap-1.5 border border-border rounded-md px-4 py-2 text-xs font-medium hover:bg-muted/40 disabled:opacity-60">
              {runSync.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Run sync now
            </button>
          )}
          <button onClick={() => save.mutate()} disabled={save.isPending}
            className="inline-flex items-center gap-1.5 gold-gradient text-charcoal rounded-md px-5 py-2 text-xs font-medium disabled:opacity-60">
            {save.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save
          </button>
        </div>
      </div>

      <div className="luxe-card rounded-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-display text-lg">Sync History</h3>
          <span className="text-[11px] text-muted-foreground">{runs.length} runs</span>
        </div>
        {runs.length === 0 ? (
          <div className="p-6 text-center text-xs text-muted-foreground">
            No sync runs yet. Provider-specific sync logic ships in the next phase.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead className="text-left text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border">
                <tr>
                  <th className="px-2 py-2">Started</th>
                  <th className="px-2 py-2">Status</th>
                  <th className="px-2 py-2 text-right">Created</th>
                  <th className="px-2 py-2 text-right">Updated</th>
                  <th className="px-2 py-2">Message</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id} className="border-b border-border/60">
                    <td className="px-2 py-2 text-muted-foreground">{new Date(r.started_at).toLocaleString("en-IN")}</td>
                    <td className="px-2 py-2"><span className="text-[10px] uppercase">{r.status}</span></td>
                    <td className="px-2 py-2 text-right tabular-nums">{r.created_count}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{r.updated_count}</td>
                    <td className="px-2 py-2 text-[11px] text-muted-foreground">{r.message ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function ConfigHint({ type }: { type: IntegrationRow["type"] }) {
  const hints: Record<typeof type, string> = {
    email_parser: `{"inbox_email":"hotelexcellaoperations@gmail.com","poll_interval_minutes":5,"subject_filter":"FabHotels"}`,
    api: `{"base_url":"https://api.provider.com","api_key_secret":"PROVIDER_API_KEY"}`,
    webhook: `{"path":"/api/public/provider-webhook","signing_secret_name":"PROVIDER_SECRET"}`,
    csv_import: `{"format":"booking_com_v1"}`,
  };
  return <div className="text-[10px] text-muted-foreground mt-1">Example: <code className="bg-muted/40 px-1 rounded">{hints[type]}</code></div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (<div className="space-y-1.5"><div className={labelCls}>{label}</div>{children}</div>);
}
