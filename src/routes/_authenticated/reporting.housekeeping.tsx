import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Topbar } from "@/components/topbar";
import { PermissionGate } from "@/components/permission-gate";
import { usePermissions } from "@/hooks/use-permissions";
import { ReportDateRangePicker } from "@/components/report-date-range-picker";
import {
  fetchHkTasksInRange, computeHkDailySummary, computeHkStaffPerformance,
  fetchWorkHistoryInRange, fetchHkExceptionAudit,
} from "@/lib/reporting/hk-reporting";
import { formatDuration, type DateRange } from "@/lib/reporting/date-range";
import { toLocalYMD } from "@/lib/utils";
import { downloadCSV } from "@/lib/csv";
import { Loader2, Download, Brush, Sparkles, MoonStar, BedDouble, ClipboardList, Clock, Package, Shirt, MessageSquareWarning, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/reporting/housekeeping")({
  component: () => (
    <PermissionGate permission="reporting.housekeeping.view">
      <HousekeepingReportingPage />
    </PermissionGate>
  ),
});

function HousekeepingReportingPage() {
  const today = toLocalYMD();
  const [range, setRange] = useState<DateRange>({ from: today, to: today, label: "Today" });
  const { has } = usePermissions();
  const canExport = has("reporting.housekeeping.export");

  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ["reporting-hk", range.from, range.to],
    queryFn: () => fetchHkTasksInRange(range.from, range.to),
  });

  const summary = useMemo(() => computeHkDailySummary(tasks), [tasks]);
  const staff = useMemo(() => computeHkStaffPerformance(tasks), [tasks]);

  const exportStaff = () => {
    try {
      downloadCSV(`hk-staff-${range.from}_to_${range.to}.csv`,
        staff.map((s) => ({
          Staff: s.performerName,
          "Checkout Rooms Cleaned": s.checkoutDone,
          "Service Rooms Completed": s.serviceDone,
          "Total Tasks": s.totalDone,
          "Avg Completion": formatDuration(s.avgCompletionSecs),
          "Consumables Used": s.consumablesUsed,
          "Linen Sent to Laundry": s.linenSent,
          "Complaints Raised": s.complaintsRaised,
        })));
      toast.success("Exported staff performance");
    } catch (e: any) { toast.error(e?.message ?? "Export failed"); }
  };

  return (
    <>
      <Topbar title="Housekeeping Reporting" subtitle="Daily operations & staff performance" />
      <div className="px-4 md:px-8 py-6 md:py-8 space-y-5 max-w-[1600px]">
        <ReportDateRangePicker value={range} onChange={(r) => setRange(r)} />

        {/* Daily Summary */}
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">Daily Summary</h2>
            <span className="text-[11px] text-muted-foreground">{summary.totalTasks} task{summary.totalTasks === 1 ? "" : "s"} in range</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
            <KpiCard label="Checkout Cleaned" value={summary.checkoutRoomsCleaned} icon={Brush} tone="gold" />
            <KpiCard label="Service Completed" value={summary.continueStayServiced} icon={Sparkles} tone="success" />
            <KpiCard label="Not Required" value={summary.skippedNotRequired} icon={BedDouble} tone="muted" />
            <KpiCard label="DND" value={summary.skippedDnd} icon={MoonStar} tone="muted" />
            <KpiCard label="Pending" value={summary.pending} icon={ClipboardList} tone={summary.pending > 0 ? "warning" : "muted"} />
            <KpiCard label="Avg Cleaning" value={formatDuration(summary.avgCleaningSecs)} icon={Clock} tone="gold" />
            <KpiCard label="Avg Service" value={formatDuration(summary.avgServiceSecs)} icon={Clock} tone="gold" />
          </div>
        </section>

        {/* Staff Performance */}
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">Staff Performance</h2>
            {canExport && staff.length > 0 && (
              <button onClick={exportStaff} className="inline-flex items-center gap-2 rounded-md gold-gradient px-3 py-1.5 text-xs font-medium text-charcoal">
                <Download className="h-3.5 w-3.5" /> Export CSV
              </button>
            )}
          </div>
          <div className="luxe-card rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-secondary/30 text-[11px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="text-left px-4 py-2.5">Staff</th>
                    <th className="text-right px-4 py-2.5">Checkout</th>
                    <th className="text-right px-4 py-2.5">Service</th>
                    <th className="text-right px-4 py-2.5">Total</th>
                    <th className="text-right px-4 py-2.5">Avg Time</th>
                    <th className="text-right px-4 py-2.5"><span className="inline-flex items-center gap-1"><Package className="h-3 w-3" /> Consumables</span></th>
                    <th className="text-right px-4 py-2.5"><span className="inline-flex items-center gap-1"><Shirt className="h-3 w-3" /> Linen Sent</span></th>
                    <th className="text-right px-4 py-2.5"><span className="inline-flex items-center gap-1"><MessageSquareWarning className="h-3 w-3" /> Issues</span></th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading && (
                    <tr><td colSpan={8} className="p-12 text-center"><Loader2 className="h-5 w-5 animate-spin text-gold mx-auto" /></td></tr>
                  )}
                  {!isLoading && staff.length === 0 && (
                    <tr><td colSpan={8} className="p-12 text-center text-muted-foreground">No completed tasks in this range.</td></tr>
                  )}
                  {staff.map((s) => (
                    <tr key={s.performerId ?? s.performerName} className="border-t border-border/60 hover:bg-secondary/30">
                      <td className="px-4 py-2.5">{s.performerName}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{s.checkoutDone}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{s.serviceDone}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums font-medium">{s.totalDone}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-xs">{formatDuration(s.avgCompletionSecs)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{s.consumablesUsed}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{s.linenSent}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{s.complaintsRaised}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <p className="text-[11px] text-muted-foreground">
          Data source: Housekeeping engine snapshots (<code className="text-foreground/70">housekeeping_tasks</code>). Durations use started/finished timestamps recorded by the shared HK write path. See related reports:{" "}
          <Link to="/reporting/laundry" className="text-gold hover:underline">Laundry</Link>,{" "}
          <Link to="/reporting/staff" className="text-gold hover:underline">Staff</Link>.
        </p>
      </div>
    </>
  );
}

function KpiCard({ label, value, icon: Icon, tone = "gold" }: { label: string; value: number | string; icon: any; tone?: "gold" | "success" | "warning" | "muted" }) {
  const toneClass =
    tone === "success" ? "text-emerald-400"
    : tone === "warning" ? "text-warning"
    : tone === "muted" ? "text-muted-foreground"
    : "text-gold";
  return (
    <div className="luxe-card rounded-xl p-3">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
        <Icon className={`h-3.5 w-3.5 ${toneClass}`} /> {label}
      </div>
      <div className={`mt-1 text-xl font-display tabular-nums ${toneClass}`}>{value}</div>
    </div>
  );
}
