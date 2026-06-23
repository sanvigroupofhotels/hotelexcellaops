import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import {
  Loader2, TrendingUp, IndianRupee, Receipt, BedDouble, Users, Building2,
  CalendarDays, AlertTriangle, Repeat, XCircle, Ghost, Wallet, BarChart3, Clock,
} from "lucide-react";
import { Topbar } from "@/components/topbar";
import { AdminOnly } from "@/components/admin-only";
import { PermissionGate } from "@/components/permission-gate";
import { getOwnerDashboardKpis } from "@/lib/owner-dashboard.functions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/reporting/owner-dashboard")({
  component: () => (
    <PermissionGate permission="reporting.analytics.view">
      <AdminOnly><OwnerDashboard /></AdminOnly>
    </PermissionGate>
  ),
});

type Preset = "today" | "7d" | "mtd" | "30d";

function rangeFor(preset: Preset): { start: string; end: string } {
  const today = new Date();
  const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const end = ymd(today);
  if (preset === "today") return { start: end, end };
  if (preset === "7d") { const s = new Date(today); s.setDate(s.getDate() - 6); return { start: ymd(s), end }; }
  if (preset === "30d") { const s = new Date(today); s.setDate(s.getDate() - 29); return { start: ymd(s), end }; }
  // mtd
  const s = new Date(today.getFullYear(), today.getMonth(), 1);
  return { start: ymd(s), end };
}

const inr = (n: number) => `₹${Math.round(Number(n || 0)).toLocaleString("en-IN")}`;
const pct = (n: number) => `${(Number(n) || 0).toFixed(1)}%`;
const fmtDate = (ymd: string) =>
  new Date(ymd + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

function OwnerDashboard() {
  const [preset, setPreset] = useState<Preset>("7d");
  const range = useMemo(() => rangeFor(preset), [preset]);

  const fetchKpis = useServerFn(getOwnerDashboardKpis);
  const q = useQuery({
    queryKey: ["owner-dashboard", range.start, range.end],
    queryFn: () => fetchKpis({ data: { range_start: range.start, range_end: range.end } }),
    staleTime: 30_000,
  });

  return (
    <>
      <Topbar title="Owner Dashboard" subtitle="Operational KPIs, revenue and channel mix" />
      <div className="px-4 md:px-8 py-6 md:py-8 space-y-6 max-w-[1400px]">
        {/* Range presets */}
        <div className="flex flex-wrap items-center gap-2">
          {(["today", "7d", "mtd", "30d"] as Preset[]).map((p) => (
            <Button
              key={p}
              size="sm"
              variant={preset === p ? "default" : "outline"}
              onClick={() => setPreset(p)}
              className={cn("text-xs", preset === p && "gold-gradient text-charcoal hover:opacity-90")}
            >
              {p === "today" ? "Today" : p === "7d" ? "Last 7 days" : p === "mtd" ? "Month to date" : "Last 30 days"}
            </Button>
          ))}
          {q.data && (
            <span className="ml-auto text-xs text-muted-foreground">
              {fmtDate(q.data.range.start)} → {fmtDate(q.data.range.end)} · {q.data.range.nights} night{q.data.range.nights === 1 ? "" : "s"}
            </span>
          )}
        </div>

        {/* Business Date vs Calendar Date */}
        {q.data && (
          <div className={cn(
            "rounded-xl border p-4 grid grid-cols-1 sm:grid-cols-3 gap-4 items-center",
            q.data.auditPending ? "border-amber-500/40 bg-amber-500/5" : "border-emerald-500/30 bg-emerald-500/5",
          )}>
            <div className="flex items-center gap-2">
              <CalendarDays className={cn("h-4 w-4", q.data.auditPending ? "text-amber-500" : "text-emerald-500")} />
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Business Date</div>
                <div className="font-medium">{fmtDate(q.data.businessDate)}</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Calendar Date</div>
                <div className="font-medium">{fmtDate(q.data.calendarDate)}</div>
              </div>
            </div>
            <div className="text-sm">
              {q.data.auditPending ? (
                <span className="inline-flex items-center gap-1.5 text-amber-700 dark:text-amber-400 font-medium">
                  <AlertTriangle className="h-4 w-4" /> Night Audit pending
                </span>
              ) : (
                <span className="text-emerald-700 dark:text-emerald-400 font-medium">Up to date</span>
              )}
            </div>
          </div>
        )}

        {q.isLoading ? (
          <div className="py-20 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-gold" /></div>
        ) : q.isError ? (
          <div className="p-6 text-sm text-destructive">Could not load KPIs.</div>
        ) : q.data ? (
          <>
            {/* Primary KPIs */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <KPI icon={BedDouble} label="Occupancy %" value={pct(q.data.kpis.occupancy_pct)} sub={`${q.data.kpis.rooms_sold} / ${q.data.kpis.available_room_nights} room-nights`} accent />
              <KPI icon={IndianRupee} label="ADR" value={inr(q.data.kpis.adr)} sub="Room Revenue ÷ Rooms Sold" />
              <KPI icon={TrendingUp} label="RevPAR" value={inr(q.data.kpis.revpar)} sub="Room Revenue ÷ Available" />
              <KPI icon={IndianRupee} label="Room Revenue" value={inr(q.data.kpis.room_revenue)} />
              <KPI icon={IndianRupee} label="Total Revenue" value={inr(q.data.kpis.total_revenue)} accent />
              <KPI icon={Receipt} label="Collections" value={inr(q.data.kpis.collections)} />
              <KPI icon={AlertTriangle} label="Outstanding Dues" value={inr(q.data.kpis.outstanding_dues)} tone={q.data.kpis.outstanding_dues > 0 ? "warn" : "ok"} />
              <KPI icon={Wallet} label="Cash Balance" value={inr(q.data.kpis.cash_balance)} />
            </div>

            {/* Secondary KPIs */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <KPI icon={BedDouble} label="Rooms Sold" value={String(q.data.kpis.rooms_sold)} sub="Room-nights" />
              <KPI icon={Repeat} label="Repeat Guests %" value={pct(q.data.kpis.repeat_pct)} sub="Of bookings in range" />
              <KPI icon={Building2} label="Direct vs OTA" value={`${pct(q.data.kpis.direct_pct)} · ${pct(q.data.kpis.ota_pct)}`} sub="Direct · OTA" />
              <KPI icon={XCircle} label="Cancellation %" value={pct(q.data.kpis.cancellation_pct)} tone={q.data.kpis.cancellation_pct > 10 ? "warn" : undefined} />
              <KPI icon={Ghost} label="No-Show %" value={pct(q.data.kpis.no_show_pct)} tone={q.data.kpis.no_show_pct > 5 ? "warn" : undefined} />
              <KPI icon={Users} label="ALOS" value={`${q.data.kpis.alos.toFixed(1)} nights`} sub="Avg Length of Stay" />
              <KPI icon={Building2} label="Active Rooms" value={String(q.data.kpis.active_rooms)} />
            </div>

            {/* Top revenue rooms */}
            <div className="luxe-card rounded-xl p-5">
              <h3 className="font-display text-lg mb-4 flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-gold" /> Top 5 Revenue-Generating Categories
              </h3>
              {q.data.topRooms.length === 0 ? (
                <p className="text-sm text-muted-foreground italic">No revenue in range yet.</p>
              ) : (
                <div className="space-y-2">
                  {q.data.topRooms.map((r) => {
                    const max = q.data!.topRooms[0].revenue || 1;
                    return (
                      <div key={r.category} className="grid grid-cols-12 gap-3 items-center text-sm">
                        <div className="col-span-4 truncate">{r.category}</div>
                        <div className="col-span-6 h-2.5 bg-secondary/40 rounded">
                          <div className="h-full gold-gradient rounded" style={{ width: `${(r.revenue / max) * 100}%` }} />
                        </div>
                        <div className="col-span-2 text-right tabular-nums text-gold">{inr(r.revenue)}</div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        ) : null}
      </div>
    </>
  );
}

function KPI({
  icon: Icon, label, value, sub, accent, tone,
}: {
  icon: any; label: string; value: string; sub?: string;
  accent?: boolean; tone?: "warn" | "ok";
}) {
  return (
    <div className={cn(
      "luxe-card rounded-xl p-4",
      accent && "ring-1 ring-gold/30",
      tone === "warn" && "ring-1 ring-amber-500/40",
    )}>
      <div className="flex items-center justify-between">
        <div className={cn(
          "h-8 w-8 rounded-md flex items-center justify-center",
          accent ? "gold-gradient text-charcoal" : "bg-secondary text-gold",
        )}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <div className="font-display text-2xl mt-3 tabular-nums">{value}</div>
      <div className="text-[11px] text-muted-foreground mt-0.5">{label}</div>
      {sub && <div className="text-[10px] text-muted-foreground/80 mt-0.5">{sub}</div>}
    </div>
  );
}
