import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Topbar } from "@/components/topbar";
import { PermissionGate } from "@/components/permission-gate";
import { usePermissions } from "@/hooks/use-permissions";
import { ReportDateRangePicker } from "@/components/report-date-range-picker";
import {
  fetchLaundryBatchesInRange, fetchLaundryQueueBefore, fetchInHouseReturnedInRange,
  computeLaundryDailySummary, computeLaundryVendorSummary, sumPreviousMissing,
  computeLaundryBatchDetails,
} from "@/lib/reporting/laundry-reporting";
import { formatDuration, type DateRange } from "@/lib/reporting/date-range";
import { toLocalYMD } from "@/lib/utils";
import { downloadCSV } from "@/lib/csv";
import { Loader2, Download, Shirt, PackageCheck, Home, AlertTriangle, Truck, ShieldAlert, XCircle, Boxes, FileText, ExternalLink } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/reporting/laundry")({
  component: () => (
    <PermissionGate permission="reporting.laundry.view">
      <LaundryReportingPage />
    </PermissionGate>
  ),
});

function LaundryReportingPage() {
  const today = toLocalYMD();
  const [range, setRange] = useState<DateRange>({ from: today, to: today, label: "Today" });
  const { has } = usePermissions();
  const canExport = has("reporting.laundry.export");

  const { data: batches = [], isLoading: lb } = useQuery({
    queryKey: ["reporting-laundry-batches", range.from, range.to],
    queryFn: () => fetchLaundryBatchesInRange(range.from, range.to),
  });
  const { data: prevMissingQueue = [] } = useQuery({
    queryKey: ["reporting-laundry-prev-missing", range.from],
    queryFn: () => fetchLaundryQueueBefore(range.from),
  });
  const { data: inHouseWashed = 0 } = useQuery({
    queryKey: ["reporting-laundry-in-house", range.from, range.to],
    queryFn: () => fetchInHouseReturnedInRange(range.from, range.to),
  });

  const summary = useMemo(() => computeLaundryDailySummary({
    batches, from: range.from, to: range.to,
    inHouseWashed,
    previousMissing: sumPreviousMissing(prevMissingQueue),
  }), [batches, prevMissingQueue, inHouseWashed, range]);

  const vendors = useMemo(() => computeLaundryVendorSummary(batches, range.from, range.to), [batches, range]);

  const exportVendors = () => {
    try {
      downloadCSV(`laundry-vendors-${range.from}_to_${range.to}.csv`,
        vendors.map((v) => ({
          Vendor: v.vendorName,
          "Total Batches": v.totalBatches,
          "Total Sent": v.linenSent,
          "Total Returned": v.linenReturned,
          Outstanding: v.outstanding,
          Damaged: v.damaged,
          Lost: v.lost,
          "Avg Turnaround": formatDuration(v.avgTurnaroundSecs),
        })));
      toast.success("Exported vendor summary");
    } catch (e: any) { toast.error(e?.message ?? "Export failed"); }
  };

  return (
    <>
      <Topbar title="Laundry Reporting" subtitle="Linen movement, vendor turnaround, and losses" />
      <div className="px-4 md:px-8 py-6 md:py-8 space-y-5 max-w-[1600px]">
        <ReportDateRangePicker value={range} onChange={(r) => setRange(r)} />

        {/* Daily Summary */}
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">Daily Summary</h2>
            <span className="text-[11px] text-muted-foreground">{summary.totalBatches} batch{summary.totalBatches === 1 ? "" : "es"} sent in range</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
            <KpiCard label="Linen Sent" value={summary.linenSent} icon={Shirt} tone="gold" />
            <KpiCard label="Returned OK" value={summary.linenReturned} icon={PackageCheck} tone="success" />
            <KpiCard label="In-house Washed" value={summary.inHouseWashed} icon={Home} tone="gold" />
            <KpiCard label="Previous Missing" value={summary.previousMissing} icon={AlertTriangle} tone={summary.previousMissing > 0 ? "warning" : "muted"} />
            <KpiCard label="Outstanding" value={summary.outstandingWithVendor} icon={Truck} tone={summary.outstandingWithVendor > 0 ? "warning" : "muted"} />
            <KpiCard label="Damaged" value={summary.damaged} icon={ShieldAlert} tone={summary.damaged > 0 ? "warning" : "muted"} />
            <KpiCard label="Lost" value={summary.lost} icon={XCircle} tone={summary.lost > 0 ? "destructive" : "muted"} />
          </div>
        </section>

        {/* Vendor Summary */}
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">Vendor Summary</h2>
            {canExport && vendors.length > 0 && (
              <button onClick={exportVendors} className="inline-flex items-center gap-2 rounded-md gold-gradient px-3 py-1.5 text-xs font-medium text-charcoal">
                <Download className="h-3.5 w-3.5" /> Export CSV
              </button>
            )}
          </div>
          <div className="luxe-card rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-secondary/30 text-[11px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="text-left px-4 py-2.5">Vendor</th>
                    <th className="text-right px-4 py-2.5">Batches</th>
                    <th className="text-right px-4 py-2.5">Sent</th>
                    <th className="text-right px-4 py-2.5">Returned</th>
                    <th className="text-right px-4 py-2.5">Outstanding</th>
                    <th className="text-right px-4 py-2.5">Damaged</th>
                    <th className="text-right px-4 py-2.5">Lost</th>
                    <th className="text-right px-4 py-2.5">Avg Turnaround</th>
                  </tr>
                </thead>
                <tbody>
                  {lb && (
                    <tr><td colSpan={8} className="p-12 text-center"><Loader2 className="h-5 w-5 animate-spin text-gold mx-auto" /></td></tr>
                  )}
                  {!lb && vendors.length === 0 && (
                    <tr><td colSpan={8} className="p-12 text-center text-muted-foreground">No vendor batches in this range.</td></tr>
                  )}
                  {vendors.map((v) => (
                    <tr key={v.vendorId} className="border-t border-border/60 hover:bg-secondary/30">
                      <td className="px-4 py-2.5">
                        <Link to="/operations/vendors" className="hover:underline">{v.vendorName}</Link>
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{v.totalBatches}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{v.linenSent}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{v.linenReturned}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{v.outstanding > 0 ? <span className="text-warning">{v.outstanding}</span> : v.outstanding}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{v.damaged}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{v.lost}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-xs">{formatDuration(v.avgTurnaroundSecs)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

      </div>
    </>
  );
}

// (Developer footer text removed for production per UAT sprint.)

function KpiCard({ label, value, icon: Icon, tone = "gold" }: { label: string; value: number | string; icon: any; tone?: "gold" | "success" | "warning" | "muted" | "destructive" }) {
  const toneClass =
    tone === "success" ? "text-emerald-400"
    : tone === "warning" ? "text-warning"
    : tone === "destructive" ? "text-destructive"
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
