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

type SyncDebugResponse = {
  gmail_account?: string | null;
  query: string;
  scanned: number;
  matched: number;
  parsed: number;
  created: number;
  updated: number;
  errors?: string[];
  parser_errors?: string[];
  first_5_email_subjects_seen?: { date?: string; from: string; subject: string }[];
  diagnostic_searches?: { query: string; count: number; resultSizeEstimate: number; samples: { from: string; subject: string }[]; error?: string }[];
};

function extractMetric(text: string, label: string): number {
  const re = new RegExp(`${label}\\s+(\\d+)`, "i");
  const m = text.match(re);
  return m ? Number(m[1]) : 0;
}

function latestRunDebug(runs: any[]): Partial<SyncDebugResponse> | null {
  const latest = runs[0];
  if (!latest) return null;
  const body = `${latest.message ?? ""}\n${latest.payload_excerpt ?? ""}`;
  const query = body.match(/Query:\s*([^\n]+)/i)?.[1] ?? body.match(/query="([^"]+)"/i)?.[1] ?? "—";
  const samplesBlock = body.match(/First 5 email subjects\/senders seen:\n([\s\S]*?)(?:\nParser errors:|\nErrors:|\nDiagnostic Gmail searches:|$)/i)?.[1] ?? "";
  const errorsBlock = body.match(/(?:Parser errors|Errors):\n([\s\S]*?)(?:\nDiagnostic Gmail searches:|$)/i)?.[1] ?? "";
  return {
    gmail_account: body.match(/Gmail account:\s*([^\n]+)/i)?.[1] ?? undefined,
    query,
    scanned: extractMetric(body, "scanned") || extractMetric(body, "Emails Scanned:"),
    matched: extractMetric(body, "matched") || extractMetric(body, "Emails Matched:"),
    parsed: extractMetric(body, "parsed") || extractMetric(body, "Emails Parsed:"),
    created: latest.created_count ?? (extractMetric(body, "created") || extractMetric(body, "Bookings Created:")),
    updated: latest.updated_count ?? (extractMetric(body, "updated") || extractMetric(body, "Bookings Updated:")),
    errors: errorsBlock ? errorsBlock.split("\n").filter(Boolean) : [],
    first_5_email_subjects_seen: samplesBlock.split("\n").filter(Boolean).map((line: string) => ({ from: line.replace(/^-\s*From:\s*/i, "").split(" | Subject:")[0] ?? "", subject: line.split(" | Subject:")[1] ?? line })),
  };
}

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

  const runSync = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/public/hotelzify-poll", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || `Sync failed (${res.status})`);
      return data as SyncDebugResponse;
    },
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ["integration", id] });
      qc.invalidateQueries({ queryKey: ["integration-runs", id] });
      toast.success(`Sync done · scanned ${d.scanned} · created ${d.created} · updated ${d.updated}`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  if (isLoading || !row) return <div className="p-8"><Loader2 className="h-5 w-5 animate-spin text-gold" /></div>;
  const debugInfo = runSync.data ?? latestRunDebug(runs);

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

      {row.provider === "hotelzify" && debugInfo && (
        <div className="luxe-card rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h3 className="font-display text-lg">Hotelzify Sync Diagnostics</h3>
            <span className="text-[11px] text-muted-foreground">Connected Gmail: {debugInfo.gmail_account ?? "—"}</span>
          </div>
          <div className="text-[11px] text-muted-foreground bg-muted/30 rounded px-3 py-2 break-all">
            Gmail Query Used: <span className="text-foreground">{debugInfo.query ?? "—"}</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
            <Metric label="Emails Scanned" value={debugInfo.scanned ?? 0} />
            <Metric label="Emails Matched" value={debugInfo.matched ?? 0} />
            <Metric label="Emails Parsed" value={debugInfo.parsed ?? 0} />
            <Metric label="Bookings Created" value={debugInfo.created ?? 0} />
            <Metric label="Bookings Updated" value={debugInfo.updated ?? 0} />
            <Metric label="Errors" value={(debugInfo.errors ?? []).length + (debugInfo.parser_errors ?? []).length} />
          </div>
          <DebugList title="First 5 email subjects seen" empty="No emails returned for the main query." items={(debugInfo.first_5_email_subjects_seen ?? []).map((s) => `${s.from || "—"} — ${s.subject || "—"}`)} />
          <DebugList title="Errors / parser errors" empty="No errors recorded." items={[...(debugInfo.parser_errors ?? []), ...(debugInfo.errors ?? [])]} />
          {!!debugInfo.diagnostic_searches?.length && (
            <div className="space-y-1.5">
              <div className={labelCls}>Fallback Gmail search checks</div>
              <div className="space-y-2 text-[11px] text-muted-foreground">
                {debugInfo.diagnostic_searches.map((d) => (
                  <div key={d.query} className="bg-muted/25 rounded px-3 py-2">
                    <div className="break-all text-foreground">{d.query}</div>
                    <div>Returned {d.count} · Estimate {d.resultSizeEstimate}{d.error ? ` · Error: ${d.error}` : ""}</div>
                    {d.samples?.slice(0, 5).map((s, idx) => <div key={idx}>• {s.from || "—"} — {s.subject || "—"}</div>)}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="luxe-card rounded-xl p-5 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h3 className="font-display text-lg">Sync History</h3>
          <span className="text-[11px] text-muted-foreground">
            Last sync: {row.last_sync_at ? new Date(row.last_sync_at).toLocaleString("en-IN") : "—"} · Imported total: {row.bookings_imported ?? 0}
          </span>
        </div>
        {row.last_sync_message && (
          <div className="text-[11px] text-muted-foreground bg-muted/30 rounded px-3 py-2">{row.last_sync_message}</div>
        )}
        {runs.length === 0 ? (
          <div className="p-6 text-center text-xs text-muted-foreground">No sync runs yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[720px]">
              <thead className="text-left text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border">
                <tr>
                  <th className="px-2 py-2">Started</th>
                  <th className="px-2 py-2">Status</th>
                  <th className="px-2 py-2 text-right">Created</th>
                  <th className="px-2 py-2 text-right">Updated</th>
                  <th className="px-2 py-2">Details</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id} className="border-b border-border/60 align-top">
                    <td className="px-2 py-2 text-muted-foreground whitespace-nowrap">{new Date(r.started_at).toLocaleString("en-IN")}</td>
                    <td className="px-2 py-2"><span className="text-[10px] uppercase">{r.status}</span></td>
                    <td className="px-2 py-2 text-right tabular-nums">{r.created_count}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{r.updated_count}</td>
                    <td className="px-2 py-2 text-[11px] text-muted-foreground">
                      <div>{r.message ?? "—"}</div>
                      {r.payload_excerpt && (
                        <pre className="mt-1 whitespace-pre-wrap text-[10px] opacity-70">{r.payload_excerpt}</pre>
                      )}
                    </td>
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

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-muted/25 rounded-lg px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function DebugList({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  return (
    <div className="space-y-1.5">
      <div className={labelCls}>{title}</div>
      <div className="bg-muted/25 rounded px-3 py-2 text-[11px] text-muted-foreground space-y-1">
        {items.length === 0 ? <div>{empty}</div> : items.slice(0, 8).map((item, idx) => <div key={`${item}-${idx}`}>• {item}</div>)}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (<div className="space-y-1.5"><div className={labelCls}>{label}</div>{children}</div>);
}
