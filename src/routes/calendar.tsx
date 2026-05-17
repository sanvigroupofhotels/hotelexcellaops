import { createFileRoute } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { Topbar } from "@/components/topbar";
import { mockQuotes } from "@/lib/mock-data";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/calendar")({
  component: CalendarPage,
});

function CalendarPage() {
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();
  const first = new Date(year, month, 1).getDay();
  const days = new Date(year, month + 1, 0).getDate();
  const cells = Array.from({ length: first + days }, (_, i) => (i < first ? null : i - first + 1));

  // mark days with quotes (parse checkIn like "25 May")
  const dayMap: Record<number, number> = {};
  mockQuotes.forEach((q) => {
    const d = parseInt(q.checkIn.split(" ")[0]);
    if (!isNaN(d)) dayMap[d] = (dayMap[d] ?? 0) + 1;
  });

  return (
    <>
      <Topbar title="Calendar" subtitle="A bird's-eye view of upcoming arrivals" />
      <div className="px-4 md:px-8 py-6 md:py-8 max-w-[1100px]">
        <div className="luxe-card rounded-2xl p-5 md:p-8">
          <div className="flex items-center justify-between mb-6">
            <h3 className="font-display text-2xl">
              {today.toLocaleString("default", { month: "long" })} <span className="text-gold">{year}</span>
            </h3>
            <div className="flex gap-2">
              <button className="px-3 py-1.5 rounded-md border border-border text-xs hover:border-gold/40">←</button>
              <button className="px-3 py-1.5 rounded-md border border-border text-xs hover:border-gold/40">Today</button>
              <button className="px-3 py-1.5 rounded-md border border-border text-xs hover:border-gold/40">→</button>
            </div>
          </div>
          <div className="grid grid-cols-7 gap-1 text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
              <div key={d} className="text-center py-1">{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1.5">
            {cells.map((d, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: i * 0.005 }}
                className={cn(
                  "aspect-square rounded-md flex flex-col items-center justify-center text-sm relative",
                  d ? "bg-secondary/40 border border-border hover:border-gold/50 transition cursor-pointer" : "",
                  d === today.getDate() && "ring-2 ring-gold/60"
                )}
              >
                {d && <span>{d}</span>}
                {d && dayMap[d] && (
                  <span className="absolute bottom-1 h-1 w-4 rounded-full gold-gradient" />
                )}
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
