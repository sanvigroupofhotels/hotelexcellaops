import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import { Topbar } from "@/components/topbar";
import { StatusPill } from "@/components/status-pill";
import { mockQuotes, type QuoteStatus } from "@/lib/mock-data";
import { Search, Filter, Download, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/history")({
  component: History,
});

const filters: (QuoteStatus | "All")[] = ["All", "Pending", "Sent", "Negotiating", "Converted", "No Response", "Failed"];

function History() {
  const [filter, setFilter] = useState<QuoteStatus | "All">("All");
  const [query, setQuery] = useState("");

  const counts = useMemo(() => {
    const c: Record<string, number> = { All: mockQuotes.length };
    for (const q of mockQuotes) c[q.status] = (c[q.status] ?? 0) + 1;
    return c;
  }, []);

  const filtered = mockQuotes.filter(
    (q) =>
      (filter === "All" || q.status === filter) &&
      (q.guest.toLowerCase().includes(query.toLowerCase()) ||
        q.id.toLowerCase().includes(query.toLowerCase()) ||
        q.phone.includes(query))
  );

  return (
    <>
      <Topbar title="Quotes History" subtitle="Every proposal, every interaction" />
      <div className="px-4 md:px-8 py-6 md:py-8 space-y-5 max-w-[1400px]">
        <div className="flex flex-col md:flex-row md:items-center gap-3">
          <div className="flex items-center gap-2 flex-1 px-3 py-2.5 rounded-md bg-card border border-border">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input
              placeholder="Search by guest name, phone, quote ID"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="bg-transparent text-sm outline-none flex-1 placeholder:text-muted-foreground/60"
            />
          </div>
          <div className="flex gap-2">
            <button className="inline-flex items-center gap-2 px-3 py-2.5 rounded-md bg-card border border-border text-sm hover:border-gold/40">
              <Filter className="h-4 w-4 text-gold" /> Filters
            </button>
            <button className="inline-flex items-center gap-2 px-3 py-2.5 rounded-md bg-card border border-border text-sm hover:border-gold/40">
              <Download className="h-4 w-4 text-gold" /> Export
            </button>
          </div>
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-thin">
          {filters.map((f) => {
            const active = filter === f;
            return (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cn(
                  "relative whitespace-nowrap px-3.5 py-1.5 rounded-full text-xs border transition",
                  active
                    ? "border-gold/50 bg-gold-soft text-gold"
                    : "border-border bg-card text-muted-foreground hover:text-foreground hover:border-gold/30"
                )}
              >
                {f} <span className="ml-1 opacity-70">{counts[f] ?? 0}</span>
              </button>
            );
          })}
        </div>

        <div className="luxe-card rounded-xl overflow-hidden">
          <div className="hidden md:grid grid-cols-12 gap-4 px-6 py-3 text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border bg-secondary/30">
            <div className="col-span-2">Quote ID</div>
            <div className="col-span-2">Guest</div>
            <div className="col-span-3">Stay</div>
            <div className="col-span-2">Amount</div>
            <div className="col-span-2">Status</div>
            <div className="col-span-1">Updated</div>
          </div>
          {filtered.map((q, i) => (
            <motion.div
              key={q.id}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.03 }}
              className="grid grid-cols-1 md:grid-cols-12 gap-2 md:gap-4 px-4 md:px-6 py-4 border-b border-border/60 last:border-0 hover:bg-secondary/40 transition cursor-pointer group"
            >
              <div className="md:col-span-2 text-xs font-mono text-muted-foreground">{q.id}</div>
              <div className="md:col-span-2">
                <div className="text-sm">{q.guest}</div>
                <div className="text-[11px] text-muted-foreground">{q.phone}</div>
              </div>
              <div className="md:col-span-3 text-sm text-muted-foreground">
                {q.checkIn} – {q.checkOut} <span className="text-gold/70">· {q.nights}N</span>
                <div className="text-[11px] mt-0.5 text-muted-foreground/80">{q.roomType}</div>
              </div>
              <div className="md:col-span-2 text-sm font-medium">₹{q.amount.toLocaleString("en-IN")}</div>
              <div className="md:col-span-2"><StatusPill status={q.status} /></div>
              <div className="md:col-span-1 text-[11px] text-muted-foreground flex items-center justify-between">
                <span>{q.updated.split(" ").slice(0, 2).join(" ")}</span>
                <ChevronRight className="h-4 w-4 text-muted-foreground/60 group-hover:text-gold transition" />
              </div>
            </motion.div>
          ))}
          {filtered.length === 0 && (
            <div className="py-16 text-center text-sm text-muted-foreground">No quotes match your search.</div>
          )}
        </div>
      </div>
    </>
  );
}
