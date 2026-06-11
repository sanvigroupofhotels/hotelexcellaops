import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Topbar } from "@/components/topbar";
import { StatusPill } from "@/components/status-pill";
import { QUOTE_STATUSES } from "@/lib/mock-data";
import { listQuotes, deleteQuote, buildWhatsAppLink, logWhatsApp, getUserNamesByIds } from "@/lib/quotes-api";
import { useRealtimeInvalidate } from "@/hooks/use-realtime";
import { downloadCSV } from "@/lib/csv";
import { Search, Loader2, Trash2, ChevronRight, Download, MessageCircle, Phone, Plus } from "lucide-react";
import { toast } from "sonner";
import { useUserRole } from "@/hooks/use-role";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/_authenticated/history")({
  component: History,
});

function History() {
  const qc = useQueryClient();
  const { isAdmin } = useUserRole();
  useRealtimeInvalidate(["quotes"], ["quotes"], "history");
  const [query, setQuery] = useState("");
  const [exportOpen, setExportOpen] = useState(false);
  const { data: quotes = [], isLoading } = useQuery({ queryKey: ["quotes"], queryFn: listQuotes });

  const del = useMutation({
    mutationFn: deleteQuote,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["quotes"] }); toast.success("Quote deleted"); },
    onError: (e: any) => toast.error(e.message),
  });

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return quotes;
    return quotes.filter((it) =>
      `${it.guest_name} ${it.reference_code} ${it.phone} ${it.email ?? ""}`.toLowerCase().includes(q),
    );
  }, [quotes, query]);

  return (
    <>
      <Topbar title="Quotes" subtitle="Every proposal, every interaction" />
      <div className="px-4 md:px-8 py-6 md:py-8 space-y-5 max-w-[1400px]">
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="flex items-center gap-2 flex-1 px-3 py-2.5 rounded-md bg-card border border-border">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input
              placeholder="Search guest, phone, email or quote ref"
              value={query} onChange={(e) => setQuery(e.target.value)}
              className="bg-transparent text-sm outline-none flex-1 placeholder:text-muted-foreground/60"
            />
          </div>
          <button onClick={() => setExportOpen(true)} className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-4 py-2.5 text-sm hover:border-gold/40">
            <Download className="h-4 w-4 text-gold" /> Export
          </button>
          <Link to="/generate" search={{ customerId: undefined } as any}
            className="inline-flex items-center gap-2 rounded-md gold-gradient px-4 py-2.5 text-sm font-medium text-charcoal">
            <Plus className="h-4 w-4" /> New Quote
          </Link>
        </div>

        <div className="luxe-card rounded-xl overflow-hidden">
          {isLoading && <div className="p-12 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-gold" /></div>}
          {!isLoading && filtered.length === 0 && (
            <div className="py-16 text-center text-sm text-muted-foreground">No quotes match your search.</div>
          )}
          {filtered.map((q, i) => {
            const guestCount = `${q.adults}A${q.children ? ` + ${q.children}C` : ""}`;
            return (
              <motion.div key={q.id} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.02 }}
                className="px-4 md:px-6 py-4 border-b border-border/60 last:border-0 hover:bg-secondary/40 transition">
                <Link to="/quote/$id" params={{ id: q.id }} className="block">
                  <div className="grid grid-cols-3 gap-3 items-start">
                    {/* Col 1: Guest + Status */}
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{q.guest_name}</div>
                      <div className="mt-1"><StatusPill status={q.status} /></div>
                    </div>

                    {/* Col 2: Dates + Guests + Room Type (second row) */}
                    <div className="text-[11px] text-muted-foreground min-w-0">
                      <div className="whitespace-nowrap">
                        {new Date(q.check_in).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })} – {new Date(q.check_out).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
                      </div>
                      <div className="mt-0.5">{q.nights}N · {guestCount}</div>
                      <div className="text-gold/80 font-medium mt-0.5 truncate">{q.room_type}</div>
                    </div>

                    {/* Col 3: Amount (first row) + Actions */}
                    <div className="flex flex-col items-end gap-1.5">
                      <span className="text-sm font-medium gold-text-gradient whitespace-nowrap">₹{Number(q.total).toLocaleString("en-IN")}</span>
                      <div className="flex items-center gap-0.5">
                        {q.phone && (
                          <a href={`tel:${q.phone.replace(/\s+/g, "")}`} onClick={(e) => e.stopPropagation()}
                            className="p-1.5 rounded text-muted-foreground hover:text-gold hover:bg-gold-soft transition" title="Call">
                            <Phone className="h-3.5 w-3.5" />
                          </a>
                        )}
                        <a href={buildWhatsAppLink(q)} target="_blank" rel="noreferrer"
                          onClick={(e) => { e.stopPropagation(); logWhatsApp(q.id); }}
                          className="p-1.5 rounded text-muted-foreground hover:text-success hover:bg-success/10 transition" title="WhatsApp">
                          <MessageCircle className="h-3.5 w-3.5" />
                        </a>
                        {isAdmin && (
                          <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); if (confirm(`Delete quote ${q.reference_code}?`)) del.mutate(q.id); }}
                            className="p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition" title="Delete">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </div>
                    </div>
                  </div>
                </Link>
              </motion.div>
            );
          })}
        </div>
      </div>
      <ExportQuotesDialog open={exportOpen} onOpenChange={setExportOpen} quotes={quotes} />
    </>
  );
}

function ExportQuotesDialog({ open, onOpenChange, quotes }: {
  open: boolean; onOpenChange: (b: boolean) => void; quotes: any[];
}) {
  const [status, setStatus] = useState<string>("All");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const filtered = quotes.filter((q: any) => {
    if (status !== "All" && q.status !== status) return false;
    if (from && q.check_in < from) return false;
    if (to && q.check_in > to) return false;
    return true;
  });

  const onExport = async () => {
    try {
      const names = await getUserNamesByIds(filtered.map((q: any) => q.user_id));
      downloadCSV(`quotes-${toLocalYMD()}.csv`,
        filtered.map((q: any) => ({
          "Quote ID": q.reference_code,
          Guest: q.guest_name, Phone: q.phone, Email: q.email ?? "",
          "Room Type": q.room_type, Rooms: q.rooms,
          "Check-in": q.check_in, "Check-out": q.check_out, Nights: q.nights,
          Adults: q.adults, Children: q.children,
          Total: Number(q.total), Status: q.status,
          "Lead Source": q.lead_source ?? "",
          "Created By": names[q.user_id] ?? "",
          "Created": toLocalYMD(new Date(q.created_at)),
        })));
      toast.success(`Exported ${filtered.length} quote${filtered.length === 1 ? "" : "s"}`);
      onOpenChange(false);
    } catch (e: any) { toast.error(e?.message ?? "Export failed"); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Export Quotes</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <label className="block">
            <span className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Status</span>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="w-full bg-input/60 border border-border rounded-md px-3 py-2 text-sm">
              <option value="All">All statuses</option>
              {QUOTE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Check-In From</span>
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-full bg-input/60 border border-border rounded-md px-3 py-2 text-sm" />
            </label>
            <label className="block">
              <span className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Check-In To</span>
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-full bg-input/60 border border-border rounded-md px-3 py-2 text-sm" />
            </label>
          </div>
          <div className="text-xs text-muted-foreground">{filtered.length} quote{filtered.length === 1 ? "" : "s"} match</div>
        </div>
        <DialogFooter>
          <button onClick={() => onOpenChange(false)} className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground">Cancel</button>
          <button onClick={onExport} className="inline-flex items-center gap-2 rounded-md gold-gradient px-4 py-2 text-sm font-medium text-charcoal">
            <Download className="h-4 w-4" /> Export CSV
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
