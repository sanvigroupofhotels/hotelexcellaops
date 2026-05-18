import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { Topbar } from "@/components/topbar";
import { listQuotes } from "@/lib/quotes-api";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/calendar")({
  component: CalendarView,
});

function CalendarView() {
  const [cursor, setCursor] = useState(new Date());
  const { data: quotes = [], isLoading } = useQuery({ queryKey: ["quotes"], queryFn: listQuotes });

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const startPad = first.getDay();
  const days: (Date | null)[] = [];
  for (let i = 0; i < startPad; i++) days.push(null);
  for (let d = 1; d <= last.getDate(); d++) days.push(new Date(year, month, d));

  const byDate: Record<string, typeof quotes> = {};
  for (const q of quotes) {
    const k = q.check_in.slice(0, 10);
    (byDate[k] ||= []).push(q);
  }

  const monthLabel = cursor.toLocaleDateString("en-IN", { month: "long", year: "numeric" });

  return (
    <>
      <Topbar title="Calendar" subtitle="Upcoming arrivals at a glance" />
      <div className="px-4 md:px-8 py-6 md:py-8 max-w-[1400px]">
        <div className="luxe-card rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-display text-xl">{monthLabel}</h3>
            <div className="flex gap-2">
              <button
                onClick={() => setCursor(new Date(year, month - 1, 1))}
                className="p-2 rounded-md border border-border hover:border-gold/40"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                onClick={() => setCursor(new Date())}
                className="px-3 py-1.5 rounded-md border border-border text-xs hover:border-gold/40"
              >
                Today
              </button>
              <button
                onClick={() => setCursor(new Date(year, month + 1, 1))}
                className="p-2 rounded-md border border-border hover:border-gold/40"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>

          {isLoading ? (
            <div className="p-12 flex justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-gold" />
            </div>
          ) : (
            <>
              <div className="grid grid-cols-7 gap-1 text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
                {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map((d) => (
                  <div key={d} className="px-2 py-1">{d}</div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {days.map((d, i) => {
                  const k = d?.toISOString().slice(0, 10) ?? "";
                  const arr = d ? byDate[k] ?? [] : [];
                  const isToday = d && d.toDateString() === new Date().toDateString();
                  return (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: i * 0.005 }}
                      className={cn(
                        "min-h-[88px] rounded-md border border-border/50 p-2 text-xs",
                        !d && "opacity-30",
                        isToday && "border-gold/50 bg-gold-soft/40",
                      )}
                    >
                      {d && (
                        <>
                          <div className={cn("text-[11px] mb-1", isToday ? "text-gold font-medium" : "text-muted-foreground")}>
                            {d.getDate()}
                          </div>
                          <div className="space-y-1">
                            {arr.slice(0, 2).map((q) => (
                              <Link
                                key={q.id}
                                to="/quote/$id"
                                params={{ id: q.id }}
                                className="block truncate text-[10px] rounded bg-secondary px-1.5 py-0.5 border border-border hover:border-gold/40"
                              >
                                {q.guest_name}
                              </Link>
                            ))}
                            {arr.length > 2 && (
                              <div className="text-[10px] text-gold">+{arr.length - 2}</div>
                            )}
                          </div>
                        </>
                      )}
                    </motion.div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
