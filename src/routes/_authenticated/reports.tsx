import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Topbar } from "@/components/topbar";
import { listQuotes } from "@/lib/quotes-api";
import { QUOTE_STATUSES } from "@/lib/mock-data";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/reports")({
  component: Reports,
});

function Reports() {
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

  const byRoom: Record<string, number> = {};
  for (const q of quotes) byRoom[q.room_type] = (byRoom[q.room_type] ?? 0) + 1;

  return (
    <>
      <Topbar title="Reports" subtitle="Performance at a glance" />
      <div className="px-4 md:px-8 py-6 md:py-8 space-y-6 max-w-[1400px]">
        {isLoading ? (
          <div className="p-12 flex justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-gold" />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {[
                { label: "Total Quotes", value: total },
                { label: "Converted", value: converted },
                { label: "Conversion Rate", value: `${rate}%` },
                { label: "Booked Revenue", value: `₹${(revenue / 1000).toFixed(1)}k`, accent: true },
              ].map((s, i) => (
                <motion.div
                  key={s.label}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.06 }}
                  className={`luxe-card rounded-xl p-5 ${s.accent ? "ring-1 ring-gold/30" : ""}`}
                >
                  <div className="text-xs uppercase tracking-wider text-muted-foreground">{s.label}</div>
                  <div className="font-display text-3xl mt-2">{s.value}</div>
                </motion.div>
              ))}
            </div>

            <div className="luxe-card rounded-xl p-5">
              <h4 className="font-display text-lg mb-4">Quotes by Status</h4>
              <div className="space-y-3">
                {byStatus.map((b) => (
                  <div key={b.status}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-muted-foreground">{b.status}</span>
                      <span className="text-gold">{b.count}</span>
                    </div>
                    <div className="h-2 rounded-full bg-secondary overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${(b.count / max) * 100}%` }}
                        transition={{ duration: 0.6 }}
                        className="h-full gold-gradient"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="luxe-card rounded-xl p-5">
              <h4 className="font-display text-lg mb-4">Average Quote Value</h4>
              <div className="font-display text-4xl gold-text-gradient">
                ₹{avg.toLocaleString("en-IN")}
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Across {total} quote{total === 1 ? "" : "s"}
              </p>
            </div>

            <div className="luxe-card rounded-xl p-5">
              <h4 className="font-display text-lg mb-4">Top Room Types</h4>
              <div className="space-y-2">
                {Object.entries(byRoom)
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 5)
                  .map(([room, count]) => (
                    <div key={room} className="flex justify-between text-sm">
                      <span>{room}</span>
                      <span className="text-gold">{count}</span>
                    </div>
                  ))}
                {Object.keys(byRoom).length === 0 && (
                  <p className="text-sm text-muted-foreground">No data yet.</p>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}
