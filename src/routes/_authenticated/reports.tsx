import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Topbar } from "@/components/topbar";
import { listQuotes } from "@/lib/quotes-api";
import { QUOTE_STATUSES } from "@/lib/mock-data";
import { Loader2 } from "lucide-react";

/** Legacy /reports URL — redirect to CRM Analytics. */
export const Route = createFileRoute("/_authenticated/reports")({
  component: () => <Navigate to="/reporting/crm-analytics" replace />,
});

/**
 * Historical quote-funnel report. Re-exported so reporting.staff.tsx (Staff
 * Reporting wrapper) keeps compiling; the data is dormant post-Shipment 3B.
 */
export function Reports() {
  const { data: quotes = [], isLoading } = useQuery({ queryKey: ["quotes"], queryFn: listQuotes });

  const total = quotes.length;
  const BOOKED = ["Confirmed", "Completed", "Converted"];
  const revenue = quotes.filter((q) => BOOKED.includes(q.status)).reduce((s, q) => s + Number(q.total), 0);
  const avg = total ? Math.round(quotes.reduce((s, q) => s + Number(q.total), 0) / total) : 0;
  const converted = quotes.filter((q) => BOOKED.includes(q.status)).length;
  const rate = total ? Math.round((converted / total) * 100) : 0;

  const byStatus = QUOTE_STATUSES.map((s) => ({
    status: s,
    count: quotes.filter((q) => q.status === s).length,
  }));
  const max = Math.max(1, ...byStatus.map((b) => b.count));

  if (isLoading) return <div className="p-20 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-gold" /></div>;

  return (
    <>
      <Topbar title="Historical Reports" subtitle="Legacy quote funnel — retained for audit" />
      <div className="px-4 md:px-8 py-6 md:py-8 max-w-[1400px]">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {[
            { label: "Total Quotes", value: total },
            { label: "Converted", value: converted },
            { label: "Conversion Rate", value: `${rate}%` },
            { label: "Revenue", value: `₹${revenue.toLocaleString("en-IN")}` },
          ].map((s) => (
            <motion.div key={s.label} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
              className="luxe-card rounded-xl p-4">
              <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">{s.label}</div>
              <div className="text-2xl font-display">{s.value}</div>
            </motion.div>
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="luxe-card rounded-xl p-5">
            <h4 className="font-display text-lg mb-4">Quotes by Status</h4>
            <div className="space-y-2">
              {byStatus.map((b) => (
                <div key={b.status} className="flex items-center gap-3 text-sm">
                  <div className="w-28 text-muted-foreground">{b.status}</div>
                  <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                    <div className="h-full bg-gold" style={{ width: `${(b.count / max) * 100}%` }} />
                  </div>
                  <div className="w-8 text-right tabular-nums">{b.count}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="luxe-card rounded-xl p-5">
            <h4 className="font-display text-lg mb-4">Average Quote Value</h4>
            <div className="text-4xl font-display text-gold">₹{avg.toLocaleString("en-IN")}</div>
            <div className="text-xs text-muted-foreground mt-2">
              Across {total} quote{total === 1 ? "" : "s"}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
