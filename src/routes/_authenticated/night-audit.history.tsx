import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Loader2, ShieldCheck, CheckCircle2, FileText, StickyNote } from "lucide-react";
import { Topbar } from "@/components/topbar";
import { PermissionGate } from "@/components/permission-gate";
import { supabase } from "@/integrations/supabase/client";

/**
 * Audit History — sourced from night_audit_sessions (closed + reopened).
 * Each row carries a KPI snapshot (totals JSONB) captured at close time, plus
 * optional operational notes. "Open Report" jumps to the EOD Report for that
 * exact business date.
 */
export const Route = createFileRoute("/_authenticated/night-audit/history")({
  component: () => (
    <PermissionGate permission="reporting.night_audit.view">
      <AuditHistory />
    </PermissionGate>
  ),
});

interface ClosedRow {
  id: string;
  business_date: string;
  status: string;
  closed_at: string | null;
  closed_by_name: string | null;
  totals: Record<string, any> | null;
}

async function listClosedSessions(): Promise<ClosedRow[]> {
  const { data, error } = await supabase
    .from("night_audit_sessions" as any)
    .select("id,business_date,status,closed_at,closed_by_name,totals")
    .in("status", ["closed", "reopened"])
    .order("business_date", { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data as any) ?? [];
}

const inr = (n: number) => `₹${Math.round(Number(n || 0)).toLocaleString("en-IN")}`;

function AuditHistory() {
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["night-audit-history-sessions"],
    queryFn: listClosedSessions,
  });

  return (
    <>
      <Topbar title="Audit History" subtitle="Past Night Audit runs and business-date advances" />
      <div className="px-4 md:px-8 py-6 md:py-8 max-w-[1400px] space-y-4">
        <div className="luxe-card rounded-xl p-4">
          {isLoading ? (
            <div className="p-8 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-gold" /></div>
          ) : rows.length === 0 ? (
            <div className="text-sm text-muted-foreground italic p-6 text-center">No night audit runs yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border">
                  <tr>
                    <th className="text-left py-2 px-2">Business Date</th>
                    <th className="text-left py-2 px-2">Closed At</th>
                    <th className="text-left py-2 px-2">By</th>
                    <th className="text-right py-2 px-2">Occupancy</th>
                    <th className="text-right py-2 px-2">Rooms Sold</th>
                    <th className="text-right py-2 px-2">Room Revenue</th>
                    <th className="text-right py-2 px-2">Collections</th>
                    <th className="text-right py-2 px-2">Dues</th>
                    <th className="text-left py-2 px-2">Notes</th>
                    <th className="text-left py-2 px-2">Status</th>
                    <th className="text-right py-2 px-2">Report</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const t = r.totals ?? {};
                    const occ = Number(t.occupancy_pct ?? 0);
                    const roomsSold = Number(t.rooms_sold ?? 0);
                    const roomRev = Number(t.revenue_room ?? t.revenue_total ?? 0);
                    const collected = Number(t.total_collected ?? 0);
                    const dues = Number(t.pending_dues ?? 0);
                    const note = (t.notes as string | undefined) ?? "";
                    return (
                      <tr key={r.id} className="border-b border-border/40 hover:bg-secondary/20 align-top">
                        <td className="py-2 px-2 tabular-nums whitespace-nowrap">{r.business_date}</td>
                        <td className="py-2 px-2 text-xs text-muted-foreground whitespace-nowrap">
                          {r.closed_at ? new Date(r.closed_at).toLocaleString("en-IN") : "—"}
                        </td>
                        <td className="py-2 px-2 whitespace-nowrap">{r.closed_by_name ?? "—"}</td>
                        <td className="py-2 px-2 text-right tabular-nums">{occ.toFixed(1)}%</td>
                        <td className="py-2 px-2 text-right tabular-nums">{roomsSold}</td>
                        <td className="py-2 px-2 text-right tabular-nums">{inr(roomRev)}</td>
                        <td className="py-2 px-2 text-right tabular-nums">{inr(collected)}</td>
                        <td className="py-2 px-2 text-right tabular-nums">{dues > 0 ? <span className="text-rose-500">{inr(dues)}</span> : inr(0)}</td>
                        <td className="py-2 px-2 max-w-[240px]">
                          {note ? (
                            <div className="flex items-start gap-1 text-xs text-muted-foreground">
                              <StickyNote className="h-3 w-3 mt-0.5 shrink-0 text-gold" />
                              <span className="whitespace-pre-line line-clamp-3">{note}</span>
                            </div>
                          ) : <span className="text-muted-foreground/60">—</span>}
                        </td>
                        <td className="py-2 px-2">
                          {r.status === "reopened" ? (
                            <span className="inline-flex items-center rounded-full border border-amber-500/40 bg-amber-500/10 text-amber-600 px-2 py-0.5 text-[10px]">Reopened</span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-emerald-500 text-xs">
                              <CheckCircle2 className="h-3 w-3" /> Closed
                            </span>
                          )}
                        </td>
                        <td className="py-2 px-2 text-right">
                          <Link
                            to="/night-audit/eod-report"
                            search={{ session_id: r.id } as any}
                            className="inline-flex items-center gap-1 text-xs text-gold hover:underline whitespace-nowrap"
                          >
                            <FileText className="h-3 w-3" /> Open Report
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div className="text-[10px] text-muted-foreground mt-3 flex items-center gap-1">
            <ShieldCheck className="h-3 w-3" /> Showing the most recent 200 closed sessions.
          </div>
        </div>
      </div>
    </>
  );
}
