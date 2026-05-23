import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Topbar } from "@/components/topbar";
import { listQuotes } from "@/lib/quotes-api";
import { listCustomers } from "@/lib/customers-api";
import { BOOKED_STATUSES } from "@/lib/mock-data";
import { useRealtimeInvalidate } from "@/hooks/use-realtime";
import { Loader2, TrendingUp, Users, IndianRupee, Repeat } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/analytics")({
  component: Analytics,
});

const OPEN = ["Draft", "Pending", "Sent", "Negotiation", "Negotiating"];
const LOST_SET = ["Lost", "Failed", "No Response", "Cancelled", "Expired"];
const isBooked = (s: string) => (BOOKED_STATUSES as string[]).includes(s);

function Analytics() {
  useRealtimeInvalidate(["quotes", "customers"], ["quotes", "customers"], "analytics");
  const { data: quotes = [], isLoading } = useQuery({ queryKey: ["quotes"], queryFn: listQuotes });
  const { data: customers = [] } = useQuery({ queryKey: ["customers"], queryFn: listCustomers });

  if (isLoading) return <div className="p-20 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-gold" /></div>;

  const converted = quotes.filter((q) => isBooked(q.status)).length;
  const conversion = quotes.length ? Math.round((converted / quotes.length) * 100) : 0;
  const revenue = quotes.filter((q) => isBooked(q.status)).reduce((s, q) => s + Number(q.total), 0);
  const aov = converted ? Math.round(revenue / converted) : 0;
  const repeat = customers.filter((c) => c.total_bookings > 1).length;
  const repeatPct = customers.length ? Math.round((repeat / customers.length) * 100) : 0;

  // Pipeline = sum of total * probability for open quotes
  const pipeline = quotes
    .filter((q) => OPEN.includes(q.status))
    .reduce((s, q) => s + (Number(q.total) * (Number((q as any).booking_probability ?? 50) / 100)), 0);

  const sourceBreakdown: Record<string, { quotes: number; converted: number; revenue: number }> = {};
  for (const q of quotes) {
    const k = q.lead_source ?? "Direct";
    sourceBreakdown[k] ??= { quotes: 0, converted: 0, revenue: 0 };
    sourceBreakdown[k].quotes++;
    if (isBooked(q.status)) {
      sourceBreakdown[k].converted++;
      sourceBreakdown[k].revenue += Number(q.total);
    }
  }
  const roomBreakdown: Record<string, number> = {};
  for (const q of quotes.filter((x) => isBooked(x.status))) {
    roomBreakdown[q.room_type] = (roomBreakdown[q.room_type] ?? 0) + Number(q.total);
  }
  const funnel = [
    { label: "Pending", count: quotes.filter((q) => ["Draft", "Pending"].includes(q.status)).length },
    { label: "Sent", count: quotes.filter((q) => q.status === "Sent").length },
    { label: "Negotiation", count: quotes.filter((q) => ["Negotiation", "Negotiating"].includes(q.status)).length },
    { label: "Confirmed", count: converted },
    { label: "Lost", count: quotes.filter((q) => LOST_SET.includes(q.status)).length },
  ];
  const maxFunnel = Math.max(1, ...funnel.map((f) => f.count));

  return (
    <>
      <Topbar title="Analytics" subtitle="Sales pipeline, revenue forecast & lead intelligence" />
      <div className="px-4 md:px-8 py-6 md:py-8 space-y-6 max-w-[1400px]">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KPI icon={TrendingUp} label="Conversion" value={`${conversion}%`} />
          <KPI icon={IndianRupee} label="Revenue (Booked)" value={`₹${revenue.toLocaleString("en-IN")}`} accent />
          <KPI icon={IndianRupee} label="Pipeline (Forecast)" value={`₹${Math.round(pipeline).toLocaleString("en-IN")}`} />
          <KPI icon={Users} label="Avg Booking Value" value={aov ? `₹${aov.toLocaleString("en-IN")}` : "—"} />
          <KPI icon={Repeat} label="Repeat Guests" value={`${repeat} (${repeatPct}%)`} />
          <KPI icon={Users} label="Total Customers" value={customers.length} />
          <KPI icon={TrendingUp} label="Total Quotes" value={quotes.length} />
          <KPI icon={TrendingUp} label="Confirmed" value={converted} />
        </div>

        <div className="luxe-card rounded-xl p-5">
          <h3 className="font-display text-lg mb-4">Booking Funnel</h3>
          <div className="space-y-2">
            {funnel.map((f) => (
              <div key={f.label} className="flex items-center gap-3">
                <div className="w-28 text-sm text-muted-foreground">{f.label}</div>
                <div className="flex-1 h-6 bg-secondary/40 rounded-md overflow-hidden">
                  <div className="h-full gold-gradient" style={{ width: `${(f.count / maxFunnel) * 100}%` }} />
                </div>
                <div className="w-12 text-right text-sm tabular-nums">{f.count}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="luxe-card rounded-xl p-5">
            <h3 className="font-display text-lg mb-4">Lead Sources</h3>
            <div className="space-y-2">
              {Object.entries(sourceBreakdown).sort((a, b) => b[1].quotes - a[1].quotes).map(([src, s]) => (
                <div key={src} className="grid grid-cols-12 gap-2 items-center text-sm">
                  <div className="col-span-3 text-muted-foreground">{src}</div>
                  <div className="col-span-5 h-2.5 bg-secondary/40 rounded">
                    <div className="h-full gold-gradient rounded" style={{ width: `${(s.quotes / quotes.length) * 100}%` }} />
                  </div>
                  <div className="col-span-2 text-right text-xs">{s.quotes} q</div>
                  <div className="col-span-2 text-right text-xs text-gold">{s.converted} ✓</div>
                </div>
              ))}
              {Object.keys(sourceBreakdown).length === 0 && <p className="text-sm text-muted-foreground">No data yet.</p>}
            </div>
          </div>

          <div className="luxe-card rounded-xl p-5">
            <h3 className="font-display text-lg mb-4">Best Performing Rooms</h3>
            <div className="space-y-2">
              {Object.entries(roomBreakdown).sort((a, b) => b[1] - a[1]).map(([room, rev]) => (
                <div key={room} className="flex items-center justify-between text-sm">
                  <div>{room}</div>
                  <div className="text-gold tabular-nums">₹{rev.toLocaleString("en-IN")}</div>
                </div>
              ))}
              {Object.keys(roomBreakdown).length === 0 && <p className="text-sm text-muted-foreground">No bookings yet.</p>}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function KPI({ icon: Icon, label, value, accent }: any) {
  return (
    <div className={cn("luxe-card rounded-xl p-4", accent && "ring-1 ring-gold/30")}>
      <div className="flex items-center justify-between">
        <div className={cn("h-8 w-8 rounded-md flex items-center justify-center", accent ? "gold-gradient text-charcoal" : "bg-secondary text-gold")}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <div className="font-display text-2xl mt-3">{value}</div>
      <div className="text-[11px] text-muted-foreground mt-0.5">{label}</div>
    </div>
  );
}
