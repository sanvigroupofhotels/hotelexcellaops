import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Topbar } from "@/components/topbar";
import { AdminOnly } from "@/components/admin-only";
import {
  getIntegration, updateIntegration, listIntegrationRuns,
  PROVIDER_LABELS, TYPE_LABELS,
  type IntegrationStatus,
} from "@/lib/integrations-api";
import { ArrowLeft, ChevronDown, ChevronRight, Loader2 } from "lucide-react";
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

// Advanced field mapping keys → friendly label
const FIELD_KEYS: { key: string; label: string; defaults: string }[] = [
  { key: "booking_id", label: "Booking ID", defaults: "Booking ID, Booking Reference, Booking No, Booking Number" },
  { key: "guest_name", label: "Guest Name", defaults: "Guest Name, Name" },
  { key: "mobile", label: "Mobile", defaults: "Mobile, Phone, Contact" },
  { key: "email", label: "Email", defaults: "Email" },
  { key: "check_in", label: "Check-In", defaults: "Check In, Check-In, Arrival, Arrival Date" },
  { key: "check_out", label: "Check-Out", defaults: "Check Out, Check-Out, Departure, Departure Date" },
  { key: "guests", label: "Guest Count", defaults: "Guests, Adults, Guest Count" },
  { key: "room_details", label: "Room Name", defaults: "Room Name, Room Type, Room Details" },
  { key: "total_amount", label: "Total Amount", defaults: "Total Amount, Total Price, Total" },
  { key: "amount_paid", label: "Amount Paid", defaults: "Amount Paid, Paid" },
  { key: "balance_due", label: "Balance Due", defaults: "Balance Due, Balance" },
  { key: "booking_status", label: "Booking Status", defaults: "Booking Status, Status" },
  { key: "special_requests", label: "Special Request", defaults: "Special Requests, Guest Requests, Notes" },
];

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
  const [senderEmail, setSenderEmail] = useState("");
  const [inboxEmail, setInboxEmail] = useState("");
  const [lookbackDays, setLookbackDays] = useState<number>(7);
  const [subjectFilters, setSubjectFilters] = useState("");
  const [leadSource, setLeadSource] = useState("");
  const [allowUpdates, setAllowUpdates] = useState(false);
  const [fieldLabels, setFieldLabels] = useState<Record<string, string>>({});
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [rawOpen, setRawOpen] = useState(false);
  const [rawConfig, setRawConfig] = useState("{}");

  useEffect(() => {
    if (!row) return;
    const cfg = (row.config ?? {}) as any;
    setName(row.name);
    setStatus(row.status);
    setSenderEmail(cfg.sender_email ?? "");
    setInboxEmail(cfg.inbox_email ?? "");
    setLookbackDays(typeof cfg.lookback_days === "number" ? cfg.lookback_days : 7);
    setSubjectFilters(Array.isArray(cfg.subject_filters) ? cfg.subject_filters.join(", ") : "");
    setLeadSource(cfg.lead_source ?? PROVIDER_LABELS[row.provider] ?? "");
    setAllowUpdates(cfg.allow_updates === true);
    const fl = (cfg.field_labels ?? {}) as Record<string, string | string[]>;
    const normalized: Record<string, string> = {};
    for (const f of FIELD_KEYS) {
      const v = fl[f.key];
      normalized[f.key] = Array.isArray(v) ? v.join(", ") : (typeof v === "string" ? v : "");
    }
    setFieldLabels(normalized);
    setRawConfig(JSON.stringify(cfg, null, 2));
  }, [row]);

  const buildConfig = () => {
    const fl: Record<string, string[]> = {};
    for (const f of FIELD_KEYS) {
      const arr = (fieldLabels[f.key] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      if (arr.length) fl[f.key] = arr;
    }
    return {
      sender_email: senderEmail.trim() || undefined,
      inbox_email: inboxEmail.trim() || undefined,
      lookback_days: lookbackDays,
      subject_filters: subjectFilters.split(",").map((s) => s.trim()).filter(Boolean),
      lead_source: leadSource.trim() || undefined,
      allow_updates: allowUpdates,
      field_labels: fl,
    };
  };

  const save = useMutation({
    mutationFn: () => updateIntegration(id, { name, status, config: buildConfig() }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["integration", id] }); toast.success("Saved"); },
    onError: (e: any) => toast.error(e.message),
  });

  const runSync = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/public/hotelzify-poll?debug=1&integration_id=${id}`, { method: "POST" });
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

  const debugInfo = useMemo<Partial<SyncDebugResponse> | null>(() => {
    if (runSync.data) return runSync.data;
    return null;
  }, [runSync.data]);

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

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Name"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Status">
            <select className={inputCls} value={status} onChange={(e) => setStatus(e.target.value as IntegrationStatus)}>
              <option value="draft">Draft</option>
              <option value="connected">Connected</option>
              <option value="disabled">Disabled</option>
              <option value="error">Error</option>
            </select>
          </Field>
          <Field label="Sender Email"><input className={inputCls} value={senderEmail} onChange={(e) => setSenderEmail(e.target.value)} placeholder="e.g. bookings@fabhotels.com" /></Field>
          <Field label="Inbox Email (connected Gmail)"><input className={inputCls} value={inboxEmail} onChange={(e) => setInboxEmail(e.target.value)} placeholder="hotel@gmail.com" /></Field>
          <Field label="Lookback Days"><input type="number" min={1} max={365} className={inputCls} value={lookbackDays} onChange={(e) => setLookbackDays(Number(e.target.value) || 7)} /></Field>
          <Field label="Lead Source"><input className={inputCls} value={leadSource} onChange={(e) => setLeadSource(e.target.value)} placeholder="Hotelzify" /></Field>
        </div>

        <Field label="Subject Filters (comma separated)">
          <textarea className={cn(inputCls, "min-h-[60px]")} value={subjectFilters} onChange={(e) => setSubjectFilters(e.target.value)}
            placeholder="Your Booking with Hotel Excella confirmed, Your Booking with Hotel Excella is received" />
          <div className="text-[10px] text-muted-foreground mt-1">Only emails whose subject contains one of these will be parsed. Other emails (reports, marketing, invoices) are skipped silently.</div>
        </Field>

        <label className="flex items-start gap-2 rounded-md border border-border bg-muted/20 px-3 py-2.5 cursor-pointer">
          <input type="checkbox" className="mt-0.5" checked={allowUpdates} onChange={(e) => setAllowUpdates(e.target.checked)} />
          <span className="text-xs">
            <span className="font-medium">Allow updates to existing bookings</span>
            <span className="block text-[10px] text-muted-foreground mt-0.5">
              Off (default): bookings that already exist are skipped on re-sync. On: only amount, paid, status and special requests are patched — guest name, mobile, room assignment and staff notes are never overwritten.
            </span>
          </span>
        </label>


        {/* Advanced */}
        <div>
          <button type="button" onClick={() => setAdvancedOpen((v) => !v)}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            {advancedOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            Advanced Settings — Field Mappings
          </button>
          {advancedOpen && (
            <div className="mt-3 space-y-3 border-l-2 border-gold/30 pl-4">
              <p className="text-[11px] text-muted-foreground">
                Each field accepts a comma-separated list of label aliases the parser will look for in the email body. Example for Check-In: <code className="bg-muted/40 px-1 rounded">Check In, Check-In, Arrival Date</code>. Leave blank to use built-in defaults.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {FIELD_KEYS.map((f) => (
                  <Field key={f.key} label={f.label}>
                    <input className={inputCls} value={fieldLabels[f.key] ?? ""}
                      onChange={(e) => setFieldLabels((prev) => ({ ...prev, [f.key]: e.target.value }))}
                      placeholder={f.defaults} />
                  </Field>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Raw JSON (power users) */}
        <div>
          <button type="button" onClick={() => setRawOpen((v) => !v)}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            {rawOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            Raw config (read-only preview)
          </button>
          {rawOpen && (
            <pre className="mt-2 bg-muted/30 rounded p-3 text-[10px] overflow-auto max-h-[280px]">{JSON.stringify(buildConfig(), null, 2)}</pre>
          )}
        </div>

        <div className="flex flex-wrap gap-2 justify-end pt-2">
          {row.type === "email_parser" && (
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

      {row.type === "email_parser" && debugInfo && (
        <div className="luxe-card rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h3 className="font-display text-lg">{PROVIDER_LABELS[row.provider]} Sync Diagnostics</h3>
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
          <DebugList title="Parser errors" empty="No parser errors." items={debugInfo.parser_errors ?? []} />
          <DebugList title="Other errors" empty="No errors recorded." items={debugInfo.errors ?? []} />
        </div>
      )}

      <div className="luxe-card rounded-xl p-5 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h3 className="font-display text-lg">Sync History</h3>
          <span className="text-[11px] text-muted-foreground">
            Last sync: {row.last_sync_at ? new Date(row.last_sync_at).toLocaleString("en-IN") : "—"} · Imported total: <span className="tabular-nums">{row.bookings_imported ?? 0}</span>
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

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-muted/25 rounded-lg px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-xl font-semibold tabular-nums">{value}</div>
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
