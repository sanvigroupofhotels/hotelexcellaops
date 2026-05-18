import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Topbar } from "@/components/topbar";
import { StatusPill } from "@/components/status-pill";
import { QUOTE_STATUSES, type QuoteStatus } from "@/lib/mock-data";
import { listQuotes, deleteQuote, duplicateQuote } from "@/lib/quotes-api";
import { Search, Loader2, Copy, Trash2, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/history")({
  component: History,
});

const filters: (QuoteStatus | "All")[] = ["All", ...QUOTE_STATUSES];

function History() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<QuoteStatus | "All">("All");
  const [query, setQuery] = useState("");
  const { data: quotes = [], isLoading } = useQuery({ queryKey: ["quotes"], queryFn: listQuotes });

  const del = useMutation({
    mutationFn: deleteQuote,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["quotes"] });
      toast.success("Quote deleted");
    },
    onError: (e: any) => toast.error(e.message),
  });
  const dup = useMutation({
    mutationFn: duplicateQuote,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["quotes"] });
      toast.success("Quote duplicated");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const counts = useMemo(() => {
    const c: Record<string, number> = { All: quotes.length };
    for (const q of quotes) c[q.status] = (c[q.status] ?? 0) + 1;
    return c;
  }, [quotes]);

  const filtered = quotes.filter(
    (q) =>
      (filter === "All" || q.status === filter) &&
      (q.guest_name.toLowerCase().includes(query.toLowerCase()) ||
        q.reference_code.toLowerCase().includes(query.toLowerCase()) ||
        q.phone.includes(query)),
  );

  return (
    <>
      <Topbar title="Quotes History" subtitle="Every proposal, every interaction" />
      <div className="px-4 md:px-8 py-6 md:py-8 space-y-5 max-w-[1400px]">
        <div className="flex items-center gap-2 flex-1 px-3 py-2.5 rounded-md bg-card border border-border">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            placeholder="Search by guest, phone, quote ID"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="bg-transparent text-sm outline-none flex-1 placeholder:text-muted-foreground/60"
          />
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1">
          {filters.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                "whitespace-nowrap px-3.5 py-1.5 rounded-full text-xs border transition",
                filter === f
                  ? "border-gold/50 bg-gold-soft text-gold"
                  : "border-border bg-card text-muted-foreground hover:text-foreground hover:border-gold/30",
              )}
            >
              {f} <span className="ml-1 opacity-70">{counts[f] ?? 0}</span>
            </button>
          ))}
        </div>

        <div className="luxe-card rounded-xl overflow-hidden">
          <div className="hidden md:grid grid-cols-12 gap-4 px-6 py-3 text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border bg-secondary/30">
            <div className="col-span-2">Quote ID</div>
            <div className="col-span-2">Guest</div>
            <div className="col-span-3">Stay</div>
            <div className="col-span-2">Amount</div>
            <div className="col-span-2">Status</div>
            <div className="col-span-1 text-right">Actions</div>
          </div>

          {isLoading && (
            <div className="p-12 flex justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-gold" />
            </div>
          )}
          {!isLoading && filtered.length === 0 && (
            <div className="py-16 text-center text-sm text-muted-foreground">
              No quotes match your search.
            </div>
          )}

          {filtered.map((q, i) => (
            <motion.div
              key={q.id}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.02 }}
              className="grid grid-cols-1 md:grid-cols-12 gap-2 md:gap-4 px-4 md:px-6 py-4 border-b border-border/60 last:border-0 hover:bg-secondary/40 transition group"
            >
              <Link
                to="/quote/$id"
                params={{ id: q.id }}
                className="md:col-span-2 text-xs font-mono text-muted-foreground hover:text-gold"
              >
                {q.reference_code}
              </Link>
              <div className="md:col-span-2">
                <div className="text-sm">{q.guest_name}</div>
                <div className="text-[11px] text-muted-foreground">{q.phone}</div>
              </div>
              <div className="md:col-span-3 text-sm text-muted-foreground">
                {new Date(q.check_in).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}{" "}
                –{" "}
                {new Date(q.check_out).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}{" "}
                <span className="text-gold/70">· {q.nights}N</span>
                <div className="text-[11px] mt-0.5 text-muted-foreground/80">{q.room_type}</div>
              </div>
              <div className="md:col-span-2 text-sm font-medium">
                ₹{Number(q.total).toLocaleString("en-IN")}
              </div>
              <div className="md:col-span-2">
                <StatusPill status={q.status} />
              </div>
              <div className="md:col-span-1 flex items-center justify-end gap-1">
                <button
                  onClick={() => dup.mutate(q.id)}
                  className="p-1.5 rounded text-muted-foreground hover:text-gold hover:bg-gold-soft transition"
                  title="Duplicate"
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => {
                    if (confirm(`Delete quote ${q.reference_code}?`)) del.mutate(q.id);
                  }}
                  className="p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition"
                  title="Delete"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
                <Link
                  to="/quote/$id"
                  params={{ id: q.id }}
                  className="p-1.5 rounded text-muted-foreground hover:text-gold"
                  title="Open"
                >
                  <ChevronRight className="h-4 w-4" />
                </Link>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </>
  );
}
