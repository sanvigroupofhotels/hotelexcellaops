import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Topbar } from "@/components/topbar";
import { StatusPill } from "@/components/status-pill";
import { QUOTE_STATUSES, type QuoteStatus } from "@/lib/mock-data";
import { listQuotes, deleteQuote, duplicateQuote, buildWhatsAppLink, logWhatsApp, getUserNamesByIds } from "@/lib/quotes-api";
import { useRealtimeInvalidate } from "@/hooks/use-realtime";
import { downloadCSV } from "@/lib/csv";
import { Search, Loader2, Copy, Trash2, ChevronRight, Download, MessageCircle, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/history")({
  component: History,
});

const filters: (QuoteStatus | "All")[] = ["All", ...QUOTE_STATUSES];

function History() {
  const qc = useQueryClient();
  useRealtimeInvalidate(["quotes"], ["quotes"], "history");
  const [filter, setFilter] = useState<QuoteStatus | "All">("All");
  const [query, setQuery] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [createdBy, setCreatedBy] = useState<string>("All");
  const [showAdv, setShowAdv] = useState(false);
  const { data: quotes = [], isLoading } = useQuery({ queryKey: ["quotes"], queryFn: listQuotes });

  // Resolve user IDs -> display names for "Created By" filter + table label
  const { data: userNames = {} } = useQuery({
    queryKey: ["quote-user-names", quotes.map((q) => q.user_id).join(",")],
    queryFn: () => getUserNamesByIds(quotes.map((q) => q.user_id)),
    enabled: quotes.length > 0,
  });
  const userOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const q of quotes) map.set(q.user_id, userNames[q.user_id] ?? "—");
    return Array.from(map.entries());
  }, [quotes, userNames]);

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

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    return quotes.filter((it) => {
      if (filter !== "All" && it.status !== filter) return false;
      if (createdBy !== "All" && it.user_id !== createdBy) return false;
      if (dateFrom && it.check_in < dateFrom) return false;
      if (dateTo && it.check_in > dateTo) return false;
      if (q) {
        const hay = `${it.guest_name} ${it.reference_code} ${it.phone} ${it.email ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [quotes, filter, query, dateFrom, dateTo, createdBy]);

  const hasAdvFilter = !!(dateFrom || dateTo || createdBy !== "All");
  const clearAdv = () => { setDateFrom(""); setDateTo(""); setCreatedBy("All"); };

  const exportCSV = async () => {
    try {
      const names = await getUserNamesByIds(filtered.map((q) => q.user_id));
      downloadCSV(`quotes-${new Date().toISOString().slice(0, 10)}.csv`,
        filtered.map((q) => ({
          "Quote ID": q.reference_code,
          Guest: q.guest_name,
          Phone: q.phone,
          Email: q.email ?? "",
          "Room Type": q.room_type,
          Rooms: q.rooms,
          "Check-in": q.check_in,
          "Check-out": q.check_out,
          Nights: q.nights,
          Adults: q.adults,
          Children: q.children,
          "Guest Count": (q.adults || 0) + (q.children || 0),
          Subtotal: Number(q.subtotal),
          Taxes: Number(q.taxes),
          Total: Number(q.total),
          Status: q.status,
          "Payment Status": q.payment_status ?? "",
          "Lead Source": q.lead_source ?? "",
          "Created By": names[q.user_id] ?? "",
          "Created Date": new Date(q.created_at).toISOString(),
        })));
      toast.success(`Exported ${filtered.length} quote${filtered.length === 1 ? "" : "s"}`);
    } catch (e: any) {
      toast.error(e?.message ?? "CSV export failed");
    }
  };

  return (
    <>
      <Topbar title="Quotes History" subtitle="Every proposal, every interaction" />
      <div className="px-4 md:px-8 py-6 md:py-8 space-y-5 max-w-[1400px]">
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="flex items-center gap-2 flex-1 px-3 py-2.5 rounded-md bg-card border border-border">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input
              placeholder="Search guest, phone, email or quote ID"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="bg-transparent text-sm outline-none flex-1 placeholder:text-muted-foreground/60"
            />
            {(query || hasAdvFilter) && (
              <button
                onClick={() => { setQuery(""); clearAdv(); }}
                className="text-[11px] text-muted-foreground hover:text-foreground"
              >Clear</button>
            )}
          </div>
          <button
            onClick={() => setShowAdv((v) => !v)}
            className={cn(
              "inline-flex items-center gap-2 rounded-md border px-3 py-2.5 text-sm transition",
              hasAdvFilter
                ? "border-gold/40 bg-gold-soft text-gold"
                : "border-border bg-card text-muted-foreground hover:text-foreground hover:border-gold/30",
            )}
          >
            <SlidersHorizontal className="h-4 w-4" />
            Filters{hasAdvFilter && <span className="ml-1 text-[10px]">●</span>}
          </button>
          <button onClick={exportCSV} className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-4 py-2.5 text-sm hover:border-gold/40">
            <Download className="h-4 w-4 text-gold" /> Export CSV
          </button>
        </div>

        {showAdv && (
          <div className="luxe-card rounded-xl p-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="block">
              <span className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Check-in from</span>
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
                className="w-full bg-input/60 border border-border rounded-md px-3 py-2 text-sm" />
            </label>
            <label className="block">
              <span className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Check-in to</span>
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
                className="w-full bg-input/60 border border-border rounded-md px-3 py-2 text-sm" />
            </label>
            <label className="block">
              <span className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Created by</span>
              <select value={createdBy} onChange={(e) => setCreatedBy(e.target.value)}
                className="w-full bg-input/60 border border-border rounded-md px-3 py-2 text-sm">
                <option value="All">All staff</option>
                {userOptions.map(([id, name]) => (
                  <option key={id} value={id}>{name}</option>
                ))}
              </select>
            </label>
            <div className="sm:col-span-3 flex justify-end">
              <button onClick={clearAdv} className="text-xs text-muted-foreground hover:text-foreground">
                Reset filters
              </button>
            </div>
          </div>
        )}

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
                <a
                  href={buildWhatsAppLink(q)}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => { e.stopPropagation(); logWhatsApp(q.id); }}
                  className="p-1.5 rounded text-muted-foreground hover:text-success hover:bg-success/10 transition"
                  title="WhatsApp"
                >
                  <MessageCircle className="h-3.5 w-3.5" />
                </a>
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
