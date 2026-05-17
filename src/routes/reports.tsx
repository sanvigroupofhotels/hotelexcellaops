import { createFileRoute } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { Topbar } from "@/components/topbar";
import { kpis, mockQuotes } from "@/lib/mock-data";
import { TrendingUp, IndianRupee, Percent, BarChart3 } from "lucide-react";

export const Route = createFileRoute("/reports")({
  component: Reports,
});

function Reports() {
  const byStatus = mockQuotes.reduce<Record<string, number>>((acc, q) => {
    acc[q.status] = (acc[q.status] ?? 0) + 1;
    return acc;
  }, {});
  const max = Math.max(...Object.values(byStatus));

  const stats = [
    { label: "Conversion Rate", value: `${kpis.conversionRate}%`, icon: Percent },
    { label: "Avg Quote Value", value: `₹${kpis.avgQuoteValue.toLocaleString("en-IN")}`, icon: IndianRupee },
    { label: "Est. Revenue", value: `₹${kpis.estRevenue.toLocaleString("en-IN")}`, icon: TrendingUp },
    { label: "Total Quotes", value: kpis.totalQuotes, icon: BarChart3 },
  ];

  return (
    <>
      <Topbar title="Reports" subtitle="Performance and trends across your reservations" />
      <div className="px-4 md:px-8 py-6 md:py-8 space-y-6 max-w-[1400px]">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
          {stats.map((s, i) => {
            const Icon = s.icon;
            return (
              <motion.div
                key={s.label}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.08 }}
                className="luxe-card rounded-xl p-5"
              >
                <div className="h-9 w-9 rounded-md bg-gold-soft border border-gold/30 flex items-center justify-center mb-4">
                  <Icon className="h-4 w-4 text-gold" />
                </div>
                <div className="font-display text-3xl">{s.value}</div>
                <div className="text-xs text-muted-foreground mt-1">{s.label}</div>
              </motion.div>
            );
          })}
        </div>

        <div className="luxe-card rounded-xl p-6">
          <h3 className="font-display text-xl mb-6">Quotes by Status</h3>
          <div className="space-y-4">
            {Object.entries(byStatus).map(([k, v], i) => (
              <div key={k}>
                <div className="flex justify-between text-xs mb-1.5">
                  <span className="text-muted-foreground">{k}</span>
                  <span className="text-gold">{v}</span>
                </div>
                <div className="h-2 rounded-full bg-secondary overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${(v / max) * 100}%` }}
                    transition={{ duration: 0.8, delay: i * 0.1, ease: "easeOut" }}
                    className="h-full gold-gradient"
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
