import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { motion } from "framer-motion";
import { Topbar } from "@/components/topbar";
import { listCustomers, deleteCustomer } from "@/lib/customers-api";
import { listQuotes } from "@/lib/quotes-api";
import { listLeads, markLeadLost, reopenLead } from "@/lib/leads.functions";
import { useRealtimeInvalidate } from "@/hooks/use-realtime";
import { downloadCSV } from "@/lib/csv";
import { LEAD_SOURCES, DEFAULT_TAGS } from "@/lib/mock-data";
import { useMasterData } from "@/hooks/use-master-data";
import {
  Search, Loader2, Download, Trash2, ChevronRight, Star, Phone, MessageCircle, Mail, Plus, X,
  FilePlus, BedDouble, Sparkles, AlertCircle, CheckCircle2, RotateCcw,
} from "lucide-react";
import { cn, toLocalYMD } from "@/lib/utils";
import { toast } from "sonner";
import { useUserRole } from "@/hooks/use-role";
import { CustomerEditDialog } from "@/components/customer-edit-dialog";
import { phoneToWaDigits } from "@/lib/phone";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";

export const Route = createFileRoute("/_authenticated/customers")({
  component: CustomersPage,
});

type Tab = "all" | "leads" | "customers" | "repeat" | "lost";

function CustomersPage() {
  const qc = useQueryClient();
  const { isAdmin } = useUserRole();
  useRealtimeInvalidate(["customers", "quotes", "leads"], ["customers", "quotes", "leads"], "customers");
  const { data: customers = [], isLoading } = useQuery({ queryKey: ["customers"], queryFn: listCustomers });
  const { data: quotes = [] } = useQuery({ queryKey: ["quotes"], queryFn: listQuotes });
  const fetchLeads = useServerFn(listLeads);
  const { data: leads = [] } = useQuery({ queryKey: ["leads"], queryFn: () => fetchLeads() });
  const markLost = useServerFn(markLeadLost);
  const reopen = useServerFn(reopenLead);
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<Tab>("all");
  const [newOpen, setNewOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [lostDialog, setLostDialog] = useState<{ id: string; name: string } | null>(null);
  const [lostReason, setLostReason] = useState("");

  const del = useMutation({
    mutationFn: deleteCustomer,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["customers"] }); toast.success("Customer removed"); },
    onError: (e: any) => toast.error(e.message),
  });

  const customerIdsByQuoteRef = useMemo(() => {
    const ql = q.trim().toLowerCase();
    if (!ql) return null;
    const ids = new Set<string>();
    for (const row of quotes) {
      if (row.customer_id && row.reference_code?.toLowerCase().includes(ql)) ids.add(row.customer_id);
    }
    return ids;
  }, [quotes, q]);

  const filteredAllCustomers = useMemo(() => customers.filter((c) => {
    if (!q) return true;
    const ql = q.toLowerCase();
    return (
      c.guest_name.toLowerCase().includes(ql) ||
      (c.phone ?? "").includes(q) ||
      (c.email ?? "").toLowerCase().includes(ql) ||
      c.customer_reference.toLowerCase().includes(ql) ||
      (customerIdsByQuoteRef?.has(c.id) ?? false)
    );
  }), [customers, q, customerIdsByQuoteRef]);

  const filtered = useMemo(() => {
    let list = filteredAllCustomers;
    if (tab === "customers") list = list.filter((c) => (c.total_bookings ?? 0) >= 1 && (c.total_bookings ?? 0) < 2);
    if (tab === "repeat")    list = list.filter((c) => (c.total_bookings ?? 0) >= 2);
    return list;
  }, [filteredAllCustomers, tab]);

  // Lead views
  const filteredLeads = useMemo(() => {
    const ql = q.toLowerCase().trim();
    return (leads as any[]).filter((l) => {
      if (tab === "lost" && l.status !== "Lost") return false;
      if (tab === "leads" && !["Interested", "Abandoned"].includes(l.status)) return false;
      if (!ql) return true;
      return (l.guest_name ?? "").toLowerCase().includes(ql)
        || (l.phone ?? "").includes(q)
        || (l.email ?? "").toLowerCase().includes(ql);
    });
  }, [leads, q, tab]);

  const counts = useMemo(() => ({
    all: filteredAllCustomers.length,
    leads: (leads as any[]).filter((l) => ["Interested", "Abandoned"].includes(l.status)).length,
    customers: customers.filter((c) => (c.total_bookings ?? 0) >= 1 && (c.total_bookings ?? 0) < 2).length,
    repeat: customers.filter((c) => (c.total_bookings ?? 0) >= 2).length,
    lost: (leads as any[]).filter((l) => l.status === "Lost").length,
  }), [filteredAllCustomers, leads, customers]);

  const showingLeads = tab === "leads" || tab === "lost";

  return (
    <>
      <Topbar title="Customers" subtitle="Guest directory" />
      <div className="px-4 md:px-8 py-6 md:py-8 space-y-5 max-w-[1400px]">
        {/* Tabs */}
        <div className="flex gap-1 overflow-x-auto -mx-1 px-1">
          {([
            { id: "all",       label: "All",            count: counts.all },
            { id: "leads",     label: "Leads",          count: counts.leads },
            { id: "customers", label: "Customers",      count: counts.customers },
            { id: "repeat",    label: "Repeat Guests",  count: counts.repeat },
            { id: "lost",      label: "Lost Leads",     count: counts.lost },
          ] as { id: Tab; label: string; count: number }[]).map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={cn(
                "px-3 py-1.5 rounded-full text-xs whitespace-nowrap border transition",
                tab === t.id
                  ? "bg-gold-soft border-gold/40 text-gold"
                  : "border-border bg-card hover:border-gold/40 text-foreground",
              )}>
              {t.label} <span className="ml-1 text-muted-foreground tabular-nums">{t.count}</span>
            </button>
          ))}
        </div>

        <div className="flex flex-col md:flex-row gap-2">
          <div className="flex items-center gap-2 flex-1 px-3 py-2.5 rounded-md bg-card border border-border">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input
              placeholder={showingLeads ? "Search lead name, phone, email" : "Search name, phone, email, customer or quote ref"}
              value={q} onChange={(e) => setQ(e.target.value)}
              className="bg-transparent text-sm outline-none flex-1 placeholder:text-muted-foreground/60"
            />
          </div>
          {!showingLeads && (
            <button onClick={() => setExportOpen(true)} className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-4 py-2 text-sm hover:border-gold/40">
              <Download className="h-4 w-4 text-gold" /> Export
            </button>
          )}
          <button onClick={() => setNewOpen(true)} className="inline-flex items-center gap-2 rounded-md gold-gradient px-4 py-2 text-sm font-medium text-charcoal">
            <Plus className="h-4 w-4" /> New Customer
          </button>
        </div>

        {showingLeads ? (
          <div className="luxe-card rounded-xl overflow-hidden">
            {filteredLeads.length === 0 && (
              <div className="py-16 text-center text-sm text-muted-foreground">
                {tab === "lost" ? "No lost leads." : "No active leads."}
              </div>
            )}
            {filteredLeads.map((l: any) => {
              const statusColor =
                l.status === "Interested" ? "border-info/40 bg-info/10 text-info"
                : l.status === "Abandoned" ? "border-warning/40 bg-warning/10 text-warning"
                : l.status === "Converted" ? "border-success/40 bg-success/10 text-success"
                : "border-destructive/40 bg-destructive/10 text-destructive";
              const icon =
                l.status === "Interested" ? <Sparkles className="h-3 w-3"/>
                : l.status === "Abandoned" ? <AlertCircle className="h-3 w-3"/>
                : l.status === "Converted" ? <CheckCircle2 className="h-3 w-3"/>
                : <X className="h-3 w-3"/>;
              return (
                <div key={l.id} className="px-4 md:px-6 py-4 border-b border-border/60 last:border-0 hover:bg-secondary/40 transition">
                  <div className="flex items-start gap-3">
                    <Link to="/customers/$id" params={{ id: l.customer_id ?? "" }} className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{l.guest_name}</div>
                      <div className="text-[11px] text-muted-foreground mt-0.5 font-mono">{l.phone}{l.email ? ` · ${l.email}` : ""}</div>
                      <div className="text-[11px] text-muted-foreground mt-1">
                        {l.room_type_name ?? "—"} · {l.check_in ?? "?"} → {l.check_out ?? "?"}
                        {l.estimated_total ? ` · est ₹${Math.round(l.estimated_total).toLocaleString("en-IN")}` : ""}
                      </div>
                      {l.lost_reason && tab === "lost" && (
                        <div className="text-[11px] text-destructive mt-1">Lost reason: {l.lost_reason}</div>
                      )}
                    </Link>
                    <div className="flex flex-col items-end gap-2 shrink-0">
                      <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px]", statusColor)}>
                        {icon} {l.status}
                      </span>
                      <div className="flex items-center gap-0.5">
                        {l.phone && (
                          <a href={`https://wa.me/${phoneToWaDigits(l.phone)}`} target="_blank" rel="noreferrer"
                            className="p-1.5 rounded text-muted-foreground hover:text-success hover:bg-success/10 transition" title="WhatsApp">
                            <MessageCircle className="h-3.5 w-3.5" />
                          </a>
                        )}
                        {l.status !== "Lost" && l.status !== "Converted" && (
                          <button onClick={() => { setLostDialog({ id: l.id, name: l.guest_name }); setLostReason(""); }}
                            className="p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10" title="Mark Lost">
                            <X className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {l.status === "Lost" && (
                          <button onClick={async () => {
                            try { await reopen({ data: { id: l.id } }); qc.invalidateQueries({ queryKey: ["leads"] }); toast.success("Lead reopened"); }
                            catch (e: any) { toast.error(e?.message ?? "Failed"); }
                          }} className="p-1.5 rounded text-muted-foreground hover:text-info hover:bg-info/10" title="Reopen">
                            <RotateCcw className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {l.customer_id && (
                          <Link to="/customers/$id" params={{ id: l.customer_id }} className="p-1.5 rounded text-muted-foreground hover:text-gold">
                            <ChevronRight className="h-4 w-4" />
                          </Link>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (

        <div className="luxe-card rounded-xl overflow-hidden">
          {isLoading && <div className="p-12 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-gold" /></div>}
          {!isLoading && filtered.length === 0 && (
            <div className="py-16 text-center text-sm text-muted-foreground">No customers found.</div>
          )}
          {filtered.map((c, i) => {
            const leadTag = (c.tags ?? [])[0];
            return (
              <motion.div key={c.id} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.02 }}
                className="px-4 md:px-6 py-4 border-b border-border/60 last:border-0 hover:bg-secondary/40 transition">
                <div className="flex items-start gap-3">
                  {/* Left: Name → Phone → Status */}
                  <Link to="/customers/$id" params={{ id: c.id }} className="flex-1 min-w-0">
                    <div className="text-sm font-medium flex items-center gap-2">
                      {c.total_bookings > 0 && <Star className="h-3 w-3 fill-gold text-gold shrink-0" />}
                      <span className="truncate">{c.guest_name}</span>
                    </div>
                    {c.phone && (
                      <div className="text-[11px] text-muted-foreground mt-0.5 font-mono">{c.phone}</div>
                    )}
                  </Link>


                  {/* Right: Lead Source + Tag chips on one row above actions */}
                  <div className="flex flex-col items-end gap-2 shrink-0">
                    <div className="flex items-center gap-1 flex-wrap justify-end">
                      {leadTag && (
                        <span className="inline-flex items-center rounded-full border border-gold/40 bg-gold-soft text-gold px-2 py-0.5 text-[10px]">{leadTag}</span>
                      )}
                      {c.lead_source && (
                        <span className="inline-flex items-center rounded-full border border-info/40 bg-info/10 text-info px-2 py-0.5 text-[10px]">{c.lead_source}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-0.5">
                      {c.phone && (
                        <>
                          <a href={`tel:${c.phone.replace(/\s+/g, "")}`} onClick={(e) => e.stopPropagation()}
                            className="p-1.5 rounded text-muted-foreground hover:text-gold hover:bg-gold-soft transition" title="Call">
                            <Phone className="h-3.5 w-3.5" />
                          </a>
                          <a href={`https://wa.me/${phoneToWaDigits(c.phone)}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
                            className="p-1.5 rounded text-muted-foreground hover:text-success hover:bg-success/10 transition" title="WhatsApp">
                            <MessageCircle className="h-3.5 w-3.5" />
                          </a>
                        </>
                      )}
                      {c.email && (
                        <a href={`mailto:${c.email}`} onClick={(e) => e.stopPropagation()}
                          className="p-1.5 rounded text-muted-foreground hover:text-gold hover:bg-gold-soft transition" title="Email">
                          <Mail className="h-3.5 w-3.5" />
                        </a>
                      )}
                      <CreateForCustomerPopover customerId={c.id} />
                      {isAdmin && (
                        <button onClick={() => { if (confirm(`Remove ${c.guest_name}?`)) del.mutate(c.id); }}
                          className="p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                      <Link to="/customers/$id" params={{ id: c.id }} className="p-1.5 rounded text-muted-foreground hover:text-gold">
                        <ChevronRight className="h-4 w-4" />
                      </Link>
                    </div>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
      <CustomerEditDialog open={newOpen} onClose={() => setNewOpen(false)} customer={null} />
      <ExportCustomersDialog open={exportOpen} onOpenChange={setExportOpen} customers={customers} />
    </>
  );
}

function CreateForCustomerPopover({ customerId }: { customerId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button onClick={(e) => e.stopPropagation()}
          className="p-1.5 rounded text-muted-foreground hover:text-gold hover:bg-gold-soft transition" title="Create for customer">
          <Plus className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-2" onClick={(e) => e.stopPropagation()}>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground px-2 pb-1.5">Create For Customer</div>
        <Link to="/generate" search={{ customerId } as any} onClick={() => setOpen(false)}
          className="flex items-center gap-2 px-2 py-2 rounded-md text-sm hover:bg-gold-soft hover:text-gold transition">
          <FilePlus className="h-4 w-4" /> Create Quote
        </Link>
        <Link to="/bookings/new" search={{ customerId, fromQuoteId: undefined } as any} onClick={() => setOpen(false)}
          className="flex items-center gap-2 px-2 py-2 rounded-md text-sm hover:bg-gold-soft hover:text-gold transition">
          <BedDouble className="h-4 w-4" /> Create Booking
        </Link>
        <button onClick={() => setOpen(false)}
          className="w-full text-left flex items-center gap-2 px-2 py-2 rounded-md text-sm text-muted-foreground hover:text-foreground">
          Cancel
        </button>
      </PopoverContent>
    </Popover>
  );
}

function ExportCustomersDialog({ open, onOpenChange, customers }: {
  open: boolean; onOpenChange: (b: boolean) => void; customers: any[];
}) {
  const [source, setSource] = useState<string>("All");
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const { values: leadSources } = useMasterData("lead_source", [...LEAD_SOURCES]);
  const { values: tags } = useMasterData("tag", [...DEFAULT_TAGS]);

  const toggleTag = (t: string) =>
    setTagFilter((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));

  const filtered = customers.filter((c: any) => {
    if (source !== "All" && c.lead_source !== source) return false;
    if (tagFilter.length > 0 && !tagFilter.every((t) => (c.tags ?? []).includes(t))) return false;
    return true;
  });

  const onExport = async () => {
    try {
      const { getUserNamesByIds } = await import("@/lib/quotes-api");
      const names = await getUserNamesByIds(filtered.map((c: any) => c.user_id));
      downloadCSV(`customers-${toLocalYMD()}.csv`,
        filtered.map((c: any) => ({
          Reference: c.customer_reference, Name: c.guest_name,
          Phone: c.phone ?? "", Email: c.email ?? "", City: c.city ?? "",
          Status: c.status, Tags: (c.tags ?? []).join("|"), "Lead Source": c.lead_source ?? "",
          Quotes: c.total_quotes, Bookings: c.total_bookings,
          "Created By": names[c.user_id] ?? "",
          "Created": c.created_at ? toLocalYMD(new Date(c.created_at)) : "",
          "Last Stay": c.last_stay_date ?? "",
        })));
      toast.success(`Exported ${filtered.length} customer${filtered.length === 1 ? "" : "s"}`);
      onOpenChange(false);
    } catch (e: any) { toast.error(e?.message ?? "CSV export failed"); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Export Customers</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          <label className="block">
            <span className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Source</span>
            <select value={source} onChange={(e) => setSource(e.target.value)} className="w-full bg-input/60 border border-border rounded-md px-3 py-2 text-sm">
              <option value="All">All sources</option>
              {leadSources.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <div>
            <span className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Tags</span>
            <div className="flex flex-wrap gap-1.5">
              {tags.map((t) => {
                const active = tagFilter.includes(t);
                return (
                  <button key={t} onClick={() => toggleTag(t)}
                    className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] border transition",
                      active ? "border-gold/50 bg-gold-soft text-gold" : "border-border bg-card text-muted-foreground hover:border-gold/30")}>
                    {t}
                  </button>
                );
              })}
              {tagFilter.length > 0 && (
                <button onClick={() => setTagFilter([])} className="text-[10px] text-muted-foreground hover:text-foreground ml-1">
                  <X className="h-3 w-3 inline" /> Clear
                </button>
              )}
            </div>
          </div>
          <div className="text-xs text-muted-foreground">{filtered.length} customer{filtered.length === 1 ? "" : "s"} match</div>
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
