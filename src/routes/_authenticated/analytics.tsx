import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Topbar } from "@/components/topbar";
import { listQuotes } from "@/lib/quotes-api";
import { listCustomers } from "@/lib/customers-api";
import { BOOKED_STATUSES } from "@/lib/mock-data";
import { useRealtimeInvalidate } from "@/hooks/use-realtime";
import { Loader2, TrendingUp, Users, IndianRupee, Repeat } from "lucide-react";
import { cn } from "@/lib/utils";

/** Legacy /analytics URL — redirect to CRM Analytics. */
export const Route = createFileRoute("/_authenticated/analytics")({
  component: () => <Navigate to="/reporting/crm-analytics" replace />,
});

const OPEN = ["Draft", "Pending", "Sent", "Negotiation", "Negotiating"];
const LOST_SET = ["Lost", "Failed", "No Response", "Cancelled", "Expired"];
const isBooked = (s: string) => (BOOKED_STATUSES as string[]).includes(s);

/**
 * CRM Analytics view — historical quote funnel + customer LTV. Quotes are
 * dormant at DB level after Shipment 3B; this screen reads historical rows
 * only, which is the intended value of keeping quote tables read-only.
 */
export function Analytics() {
  useRealtimeInvalidate(["quotes", "customers"], ["quotes", "customers"], "analytics");
  const { data: quotes = [], isLoading } = useQuery({ queryKey: ["quotes"], queryFn: listQuotes });
  const { data: customers = [] } = useQuery({ queryKey: ["customers"], queryFn: listCustomers });

  if (isLoading) return <div className="p-20 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-gold" /></div>;

  const total = quotes.length;
  const open = quotes.filter((q) => OPEN.includes(q.status)).length;
  const won = quotes.filter((q) => isBooked(q.status)).length;
  const lost = quotes.filter((q) => LOST_SET.includes(q.status)).length;
  const revenue = quotes.filter((q) => isBooked(q.status)).reduce((s, q) => s + Number(q.total), 0);
  const winRate = total ? Math.round((won / total) * 100) : 0;
  const returning = customers.filter((c: any) => (c.total_bookings ?? 0) > 1).length;

  const stats = [
    { label: "Total Quotes", value: total, icon: TrendingUp },
    { label: "Open Funnel", value: open, icon: Repeat },
    { label: "Converted Revenue", value: `₹${revenue.toLocaleString("en-IN")}`, icon: IndianRupee },
    { label: "Win Rate", value: `${winRate}%`, icon: Users },
  ];

  return (
    <>
      <Topbar title="CRM Analytics" subtitle="Historical quote funnel and customer lifetime value" />
      <div className="px-4 md:px-8 py-6 md:py-8 max-w-[1400px]">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {stats.map((s) => (
            <div key={s.label} className="luxe-card rounded-xl p-4">
              <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground mb-2">
                <s.icon className="h-3.5 w-3.5 text-gold" /> {s.label}
              </div>
              <div className="text-2xl font-display">{s.value}</div>
            </div>
          ))}
        </div>
        <div className="luxe-card rounded-xl p-5">
          <h4 className="font-display text-lg mb-3">Funnel Breakdown</h4>
          <div className="grid grid-cols-3 gap-4 text-sm">
            <Stat label="Open" value={open} />
            <Stat label="Won" value={won} />
            <Stat label="Lost" value={lost} />
          </div>
          <div className="mt-6 text-xs text-muted-foreground">
            Returning customers: <span className="text-foreground font-medium">{returning}</span> · Total customers: {customers.length}
          </div>
        </div>
      </div>
    </>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className={cn("rounded-lg border border-border p-3")}>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-xl font-display mt-1">{value}</div>
    </div>
  );
}
