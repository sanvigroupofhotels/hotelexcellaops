import { createFileRoute, useSearch } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { Download, Printer, Loader2, StickyNote } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { EodShell } from "@/components/eod-shell";
import { Button } from "@/components/ui/button";

const Schema = z.object({ session_id: z.string().uuid().optional() });

export const Route = createFileRoute("/_authenticated/night-audit/eod-report")({
  component: EodReportPage,
  validateSearch: (raw) => Schema.parse(raw),
});

interface ClosedSession {
  id: string;
  business_date: string;
  closed_at: string | null;
  closed_by_name: string | null;
  totals: Record<string, any> | null;
}

async function getSessionById(id: string): Promise<ClosedSession | null> {
  const { data, error } = await supabase
    .from("night_audit_sessions" as any)
    .select("id,business_date,closed_at,closed_by_name,totals")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data as any) ?? null;
}

async function getLastClosedSession(): Promise<ClosedSession | null> {
  const { data, error } = await supabase
    .from("night_audit_sessions" as any)
    .select("id,business_date,closed_at,closed_by_name,totals")
    .eq("status", "closed")
    .order("closed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as any) ?? null;
}

const inr = (n: number) => `₹${Math.round(Number(n || 0)).toLocaleString("en-IN")}`;
function fmtDate(ymd?: string | null): string {
  if (!ymd) return "—";
  return new Date(ymd + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}
function fmtDT(iso?: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function EodReportPage() {
  const search = useSearch({ from: "/_authenticated/night-audit/eod-report" });
  const sessionId = search.session_id;
  const q = useQuery({
    queryKey: ["eod-session", sessionId ?? "last"],
    queryFn: () => (sessionId ? getSessionById(sessionId) : getLastClosedSession()),
  });
  const session = q.data;
  const t = (session?.totals ?? {}) as Record<string, any>;
  const notes = (t.notes as string | undefined) ?? "";

  const occupancy = Number(t.occupancy_pct ?? 0);
  const roomsSold = Number(t.rooms_sold ?? 0);
  const roomsTotal = Number(t.rooms_total ?? 0);
  const revenue = Number(t.revenue_total ?? 0);
  const cashCollected = Number(t.cash_collected ?? 0);
  const cardCollected = Number(t.card_collected ?? 0);
  const onlineCollected = Number(t.online_collected ?? 0);
  const totalCollected = Number(t.total_collected ?? cashCollected + cardCollected + onlineCollected);
  const pendingDues = Number(t.pending_dues ?? 0);

  const onPrint = () => window.print();

  return (
    <EodShell title={session ? `End of Day Report — ${fmtDate(session.business_date)}` : "End of Day Report"}>
      {q.isLoading ? (
        <div className="py-16 flex items-center justify-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : !session ? (
        <div className="rounded-lg border border-border bg-card/40 p-8 text-center">
          <div className="text-sm font-medium mb-1">No End of Day Report yet</div>
          <div className="text-xs text-muted-foreground">Perform Night Audit from the Dashboard to generate the first report.</div>
        </div>
      ) : (
        <>
          {/* Actions */}
          <div className="flex justify-end gap-2 print:hidden">
            <Button variant="outline" size="sm" onClick={onPrint} className="gap-1"><Printer className="h-4 w-4" /> Print</Button>
            <Button variant="outline" size="sm" onClick={onPrint} className="gap-1"><Download className="h-4 w-4" /> Download PDF</Button>
          </div>

          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <SummaryCard label="Occupancy" valueAccent={`${roomsSold} / ${roomsTotal || "—"}`} sub={`${occupancy.toFixed(2)}%`} />
            <SummaryCard label="Rooms Sold" valueAccent={String(roomsSold)} />
            <SummaryCard label="Today's Revenue" valueAccent={inr(revenue)} />
            <SummaryCard label="Cash Collected" valueAccent={inr(cashCollected)} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-4">
              <div className="text-xs text-muted-foreground">Pending Dues</div>
              <div className="text-lg font-semibold text-rose-500">{inr(pendingDues)}</div>
            </div>
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4">
              <div className="text-xs text-muted-foreground">Total Collected</div>
              <div className="text-lg font-semibold text-emerald-600 dark:text-emerald-400">{inr(totalCollected)}</div>
            </div>
          </div>

          {/* Sections */}
          <div className="grid gap-3 md:grid-cols-3">
            <Section title="Room Status">
              <Row k="Occupied Rooms" v={String(roomsSold)} />
              <Row k="Vacant Rooms" v={String(Math.max(0, roomsTotal - roomsSold))} />
              <Row k="Total Rooms" v={String(roomsTotal)} />
            </Section>
            <Section title="Revenue Summary">
              <Row k="Room Revenue" v={inr(revenue)} />
              <Row k="Total Revenue" v={inr(revenue)} bold />
            </Section>
            <Section title="Payment Summary">
              <Row k="Cash" v={inr(cashCollected)} />
              <Row k="Card" v={inr(cardCollected)} />
              <Row k="UPI / Online" v={inr(onlineCollected)} />
              <Row k="Total Collected" v={inr(totalCollected)} bold />
            </Section>
          </div>

          {/* Audit info */}
          <div className="rounded-lg border border-border bg-card/40 p-4">
            <div className="text-sm font-medium mb-2">Audit Info</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-1 gap-x-6 text-sm">
              <Row k="Night Audit By" v={session.closed_by_name ?? "—"} />
              <Row k="Audit Time" v={fmtDT(session.closed_at)} />
              <Row k="Business Date" v={fmtDate(session.business_date)} />
              <Row k="System Time" v={fmtDT(session.closed_at)} />
            </div>
          </div>
        </>
      )}
    </EodShell>
  );
}

function SummaryCard({ label, valueAccent, sub }: { label: string; valueAccent: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card/40 p-4">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{label}</div>
      <div className="text-lg font-semibold text-gold">{valueAccent}</div>
      {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card/40 p-4">
      <div className="text-sm font-medium mb-2">{title}</div>
      <div className="space-y-1 text-sm">{children}</div>
    </div>
  );
}

function Row({ k, v, bold }: { k: string; v: string; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{k}</span>
      <span className={bold ? "font-semibold" : ""}>{v}</span>
    </div>
  );
}
