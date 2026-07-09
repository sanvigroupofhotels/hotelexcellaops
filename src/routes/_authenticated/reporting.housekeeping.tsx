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

  const { data: history = [] } = useQuery({
    queryKey: ["reporting-hk-history", range.from, range.to],
    queryFn: () => fetchWorkHistoryInRange(range.from, range.to),
  });
  const { data: exceptions = [] } = useQuery({
    queryKey: ["reporting-hk-exceptions", range.from, range.to],
    queryFn: () => fetchHkExceptionAudit(range.from, range.to),
  });

  // Work History filter (state × type × origin) — narrows the audit lens
  // without re-querying: everything is client-side over the fetched rows.
  const [hxFilter, setHxFilter] = useState<
    | "all" | "cleaned" | "serviced" | "manual" | "skipped" | "dnd" | "not_required" | "pending"
  >("all");
  const filteredHistory = useMemo(() => {
    return history.filter((h: any) => {
      switch (hxFilter) {
        case "all": return true;
        case "cleaned": return h.state === "done" && h.type === "checkout_clean";
        case "serviced": return h.state === "done" && h.type === "continue_service";
        case "manual": return h.origin === "manual";
        case "skipped": return h.state === "skipped";
        case "dnd": return h.state === "skipped" && (h as any).skipped_reason === "dnd";
        case "not_required": return h.state === "skipped" && (h as any).skipped_reason === "not_required";
        case "pending": return h.state === "open" || h.state === "in_progress";
      }
    });
  }, [history, hxFilter]);

  const exportHistory = () => {
    try {
      downloadCSV(`hk-work-history-${range.from}_to_${range.to}.csv`,
        filteredHistory.map((h: any) => ({
          Date: h.business_date, Room: h.room_number ?? "", Type: h.type, State: h.state,
          "Skipped Reason": h.skipped_reason ?? "", Origin: h.origin,
          "Manual Reason": h.manual_reason ?? "", Started: h.started_at ?? "", Finished: h.finished_at ?? "",
          Duration: formatDuration(h.duration_secs), "Performed By": h.performed_by ?? "",
          "Recorded By": h.recorded_by ?? "", Consumables: h.consumables_qty, "Linen Sent": h.linen_qty,
          Issues: h.issues_count, Remarks: h.remarks ?? "",
        })));
      toast.success("Exported work history");
    } catch (e: any) { toast.error(e?.message ?? "Export failed"); }
  };

  const exportExceptions = () => {
    try {
      downloadCSV(`hk-exceptions-${range.from}_to_${range.to}.csv`,
        exceptions.map((e) => ({
          Date: e.business_date,
          "Expected Rooms": e.expected_rooms.join(" "),
          "Actual Rooms": e.actual_rooms.join(" "),
          "Missing (expected, not cleaned)": e.missing_rooms.join(" "),
          "Unexpected (cleaned, not expected)": e.unexpected_rooms.join(" "),
        })));
      toast.success("Exported exception audit");
    } catch (e: any) { toast.error(e?.message ?? "Export failed"); }
  };

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

        {/* Work History */}
        <section className="space-y-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">Work History</h2>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-muted-foreground">
                {filteredHistory.length} of {history.length} row{history.length === 1 ? "" : "s"}
              </span>
              {canExport && filteredHistory.length > 0 && (
                <button onClick={exportHistory} className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-[11px] hover:bg-muted/40">
                  <Download className="h-3 w-3" /> Export
                </button>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {([
              ["all", "All"],
              ["cleaned", "Cleaned"],
              ["serviced", "Serviced"],
              ["manual", "Manual"],
              ["skipped", "Skipped"],
              ["dnd", "DND"],
              ["not_required", "Not Required"],
              ["pending", "Pending"],
            ] as const).map(([v, l]) => (
              <button
                key={v}
                onClick={() => setHxFilter(v)}
                className={
                  "px-2.5 py-1 rounded-full text-[11px] border transition " +
                  (hxFilter === v
                    ? "bg-gold text-charcoal border-gold"
                    : "border-border text-muted-foreground hover:bg-muted/40")
                }
              >
                {l}
              </button>
            ))}
          </div>
          <div className="luxe-card rounded-xl overflow-hidden">
            <div className="overflow-x-auto max-h-[480px]">
              <table className="w-full text-sm">
                <thead className="bg-secondary/30 text-[11px] uppercase tracking-wider text-muted-foreground sticky top-0">
                  <tr>
                    <th className="text-left px-3 py-2">Date</th>
                    <th className="text-left px-3 py-2">Room</th>
                    <th className="text-left px-3 py-2">Type</th>
                    <th className="text-left px-3 py-2">State</th>
                    <th className="text-left px-3 py-2">Reason</th>
                    <th className="text-left px-3 py-2">Origin</th>
                    <th className="text-left px-3 py-2">Performed By</th>
                    <th className="text-right px-3 py-2">Duration</th>
                    <th className="text-right px-3 py-2">Cons.</th>
                    <th className="text-right px-3 py-2">Linen</th>
                    <th className="text-right px-3 py-2">Issues</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredHistory.length === 0 && (
                    <tr><td colSpan={11} className="p-12 text-center text-muted-foreground">No tasks match this filter.</td></tr>
                  )}
                  {filteredHistory.map((h: any) => (
                    <tr key={h.task_id} className="border-t border-border/60">
                      <td className="px-3 py-2 tabular-nums text-xs">{h.business_date}</td>
                      <td className="px-3 py-2">{h.room_number ?? "—"}</td>
                      <td className="px-3 py-2 text-xs">{h.type === "checkout_clean" ? "Checkout" : "Service"}</td>
                      <td className="px-3 py-2 text-xs">
                        <span className={
                          h.state === "done" ? "text-emerald-400"
                          : h.state === "skipped" ? "text-warning"
                          : h.state === "in_progress" ? "text-gold"
                          : "text-muted-foreground"
                        }>{h.state}</span>
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {h.state === "skipped"
                          ? (h.skipped_reason === "dnd" ? "DND"
                             : h.skipped_reason === "not_required" ? "Not Required"
                             : h.skipped_reason === "superseded_by_checkout" ? "Superseded"
                             : (h.skipped_reason ?? "—"))
                          : "—"}
                      </td>
                      <td className="px-3 py-2 text-xs">{h.origin === "manual" ? <span className="text-gold" title={h.manual_reason ?? ""}>manual</span> : h.origin.replace("auto_", "")}</td>
                      <td className="px-3 py-2 text-xs">{h.performed_by ?? "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-xs">{formatDuration(h.duration_secs)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{h.consumables_qty}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{h.linen_qty}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{h.issues_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>


        {/* Exception Audit */}
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground flex items-center gap-2">
              <AlertTriangle className="h-3.5 w-3.5 text-warning" /> Exception Audit
            </h2>
            {canExport && exceptions.length > 0 && (
              <button onClick={exportExceptions} className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-[11px] hover:bg-muted/40">
                <Download className="h-3 w-3" /> Export
              </button>
            )}
          </div>
          <div className="luxe-card rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-secondary/30 text-[11px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="text-left px-3 py-2">Date</th>
                  <th className="text-left px-3 py-2">Expected</th>
                  <th className="text-left px-3 py-2">Actual</th>
                  <th className="text-left px-3 py-2 text-warning">Missing</th>
                  <th className="text-left px-3 py-2 text-gold">Unexpected</th>
                </tr>
              </thead>
              <tbody>
                {exceptions.map((e) => (
                  <tr key={e.business_date} className="border-t border-border/60">
                    <td className="px-3 py-2 tabular-nums text-xs">{e.business_date}</td>
                    <td className="px-3 py-2 text-xs">{e.expected_rooms.join(", ") || "—"}</td>
                    <td className="px-3 py-2 text-xs">{e.actual_rooms.join(", ") || "—"}</td>
                    <td className="px-3 py-2 text-xs text-warning">{e.missing_rooms.join(", ") || "—"}</td>
                    <td className="px-3 py-2 text-xs text-gold">{e.unexpected_rooms.join(", ") || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[10px] text-muted-foreground">
            Expected rooms are derived using the same logic as the night-audit generator: checkouts on the date + occupied stays overnight, minus HK exception rows (DND / Service Not Required). "Unexpected" rows usually indicate a manual task or an operational correction.
          </p>
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
