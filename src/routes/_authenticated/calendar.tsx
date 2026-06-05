import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { Topbar } from "@/components/topbar";
import { listQuotes } from "@/lib/quotes-api";
import { listBookings } from "@/lib/bookings-api";
import { ChevronLeft, ChevronRight, Loader2, FileText, BedDouble } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/calendar")({
  component: CalendarView,
});

/** Local YYYY-MM-DD (no UTC shift). */
function localDateKey(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function CalendarView() {
  const [cursor, setCursor] = useState(new Date());
  const [selected, setSelected] = useState<string | null>(localDateKey(new Date()));
  const { data: quotes = [], isLoading: lq } = useQuery({ queryKey: ["quotes"], queryFn: listQuotes });
  const { data: bookings = [], isLoading: lb } = useQuery({ queryKey: ["bookings"], queryFn: listBookings });
  const isLoading = lq || lb;

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const startPad = first.getDay();
  const days: (Date | null)[] = [];
  for (let i = 0; i < startPad; i++) days.push(null);
  for (let d = 1; d <= last.getDate(); d++) days.push(new Date(year, month, d));

  // Index by date — arrivals (check_in) for quotes & bookings
  const { qByArrival, bByArrival, qByDep, bByDep } = useMemo(() => {
    const qa: Record<string, any[]> = {}, ba: Record<string, any[]> = {};
    const qd: Record<string, any[]> = {}, bd: Record<string, any[]> = {};
    for (const q of quotes as any[]) {
      (qa[q.check_in?.slice(0, 10)] ||= []).push(q);
      (qd[q.check_out?.slice(0, 10)] ||= []).push(q);
    }
    for (const b of bookings as any[]) {
      (ba[b.check_in?.slice(0, 10)] ||= []).push(b);
      (bd[b.check_out?.slice(0, 10)] ||= []).push(b);
    }
    return { qByArrival: qa, bByArrival: ba, qByDep: qd, bByDep: bd };
  }, [quotes, bookings]);

  const monthLabel = cursor.toLocaleDateString("en-IN", { month: "long", year: "numeric" });

  const sel = selected ?? "";
  const arrQ = qByArrival[sel] ?? [];
  const arrB = bByArrival[sel] ?? [];
  const depQ = qByDep[sel] ?? [];
  const depB = bByDep[sel] ?? [];

  return (
    <>
      <Topbar title="Calendar" subtitle="Arrivals & departures" />
      <div className="px-4 md:px-8 py-6 md:py-8 max-w-[1400px] space-y-6">
        <div className="luxe-card rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-display text-xl">{monthLabel}</h3>
            <div className="flex gap-2">
              <button onClick={() => setCursor(new Date(year, month - 1, 1))} className="p-2 rounded-md border border-border hover:border-gold/40"><ChevronLeft className="h-4 w-4" /></button>
              <button onClick={() => { const t = new Date(); setCursor(t); setSelected(localDateKey(t)); }} className="px-3 py-1.5 rounded-md border border-border text-xs hover:border-gold/40">Today</button>
              <button onClick={() => setCursor(new Date(year, month + 1, 1))} className="p-2 rounded-md border border-border hover:border-gold/40"><ChevronRight className="h-4 w-4" /></button>
            </div>
          </div>

          {isLoading ? (
            <div className="p-12 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-gold" /></div>
          ) : (
            <>
              <div className="grid grid-cols-7 gap-1 text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
                {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map((d) => <div key={d} className="px-2 py-1">{d}</div>)}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {days.map((d, i) => {
                  const k = d ? d.toISOString().slice(0, 10) : "";
                  const qCount = (qByArrival[k]?.length ?? 0) + (qByDep[k]?.length ?? 0);
                  const bCount = (bByArrival[k]?.length ?? 0) + (bByDep[k]?.length ?? 0);
                  const isToday = d && d.toDateString() === new Date().toDateString();
                  const isSel = d && k === selected;
                  return (
                    <motion.button
                      key={i}
                      type="button"
                      onClick={() => d && setSelected(k)}
                      initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.005 }}
                      className={cn(
                        "min-h-[72px] rounded-md border border-border/50 p-2 text-left text-xs transition",
                        !d && "opacity-30 pointer-events-none",
                        isToday && "border-gold/50 bg-gold-soft/40",
                        isSel && "ring-2 ring-gold/60",
                      )}
                    >
                      {d && (
                        <>
                          <div className={cn("text-[12px] font-medium mb-1", isToday ? "text-gold" : "text-foreground")}>{d.getDate()}</div>
                          {(qCount > 0 || bCount > 0) && (
                            <div className="text-[10px] space-y-0.5">
                              {qCount > 0 && <div className="text-info">Q:{qCount}</div>}
                              {bCount > 0 && <div className="text-gold">B:{bCount}</div>}
                            </div>
                          )}
                        </>
                      )}
                    </motion.button>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {selected && (
          <div className="luxe-card rounded-xl p-5">
            <h3 className="font-display text-xl mb-4">
              {new Date(selected).toLocaleDateString("en-IN", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })}
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <DaySection title="Arriving" quotes={arrQ} bookings={arrB} />
              <DaySection title="Departing" quotes={depQ} bookings={depB} />
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function DaySection({ title, quotes, bookings }: { title: string; quotes: any[]; bookings: any[] }) {
  if (quotes.length === 0 && bookings.length === 0) {
    return (
      <div>
        <h4 className="font-display text-lg mb-3">{title} Today</h4>
        <p className="text-xs text-muted-foreground italic">None</p>
      </div>
    );
  }
  return (
    <div>
      <h4 className="font-display text-lg mb-3">{title} Today</h4>
      {quotes.length > 0 && (
        <div className="mb-3">
          <div className="text-[10px] uppercase tracking-wider text-info mb-2 flex items-center gap-1.5"><FileText className="h-3 w-3" /> Quotes ({quotes.length})</div>
          <div className="space-y-1.5">
            {quotes.map((q: any) => (
              <Link key={q.id} to="/quote/$id" params={{ id: q.id }}
                className="flex items-center justify-between gap-2 rounded-md border border-border bg-card/60 px-3 py-2 text-xs hover:border-gold/40">
                <div className="min-w-0">
                  <div className="font-medium truncate">{q.guest_name}</div>
                  <div className="text-[10px] text-muted-foreground font-mono">{q.reference_code}</div>
                </div>
                <span className="text-[10px] text-muted-foreground">{q.status}</span>
              </Link>
            ))}
          </div>
        </div>
      )}
      {bookings.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-gold mb-2 flex items-center gap-1.5"><BedDouble className="h-3 w-3" /> Bookings ({bookings.length})</div>
          <div className="space-y-1.5">
            {bookings.map((b: any) => (
              <Link key={b.id} to="/bookings/$id" params={{ id: b.id }}
                className="flex items-center justify-between gap-2 rounded-md border border-border bg-card/60 px-3 py-2 text-xs hover:border-gold/40">
                <div className="min-w-0">
                  <div className="font-medium truncate">{b.guest_name}</div>
                  <div className="text-[10px] text-muted-foreground font-mono">{b.booking_reference}</div>
                </div>
                <span className="text-[10px] text-muted-foreground">{b.status}</span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
