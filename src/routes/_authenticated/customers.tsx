import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Topbar } from "@/components/topbar";
import { listCustomers, deleteCustomer } from "@/lib/customers-api";
import { listQuotes } from "@/lib/quotes-api";
import { useRealtimeInvalidate } from "@/hooks/use-realtime";
import { downloadCSV } from "@/lib/csv";
import { CUSTOMER_STATUSES, customerStatusStyles, LEAD_SOURCES } from "@/lib/mock-data";
import { Search, Loader2, Download, Trash2, ChevronRight, Star, Phone, MessageCircle, FilePlus } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useUserRole } from "@/hooks/use-role";

export const Route = createFileRoute("/_authenticated/customers")({
  component: CustomersPage,
});

function CustomersPage() {
  const qc = useQueryClient();
  const { isAdmin } = useUserRole();
  useRealtimeInvalidate(["customers", "quotes"], ["customers", "quotes"], "customers");
  const { data: customers = [], isLoading } = useQuery({ queryKey: ["customers"], queryFn: listCustomers });
  const { data: quotes = [] } = useQuery({ queryKey: ["quotes"], queryFn: listQuotes });
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string>("All");
  const [source, setSource] = useState<string>("All");

  const del = useMutation({
    mutationFn: deleteCustomer,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["customers"] }); toast.success("Customer removed"); },
    onError: (e: any) => toast.error(e.message),
  });

  // Build a lookup of quote-reference → customer_id so search can match HEX-… codes
  const customerIdsByQuoteRef = useMemo(() => {
    const ql = q.trim().toLowerCase();
    if (!ql) return null;
    const ids = new Set<string>();
    for (const row of quotes) {
      if (row.customer_id && row.reference_code?.toLowerCase().includes(ql)) {
        ids.add(row.customer_id);
      }
    }
    return ids;
  }, [quotes, q]);

  const filtered = useMemo(() => customers.filter((c) => {
    if (status !== "All" && c.status !== status) return false;
    if (source !== "All" && c.lead_source !== source) return false;
    if (!q) return true;
    const ql = q.toLowerCase();
    return (
      c.guest_name.toLowerCase().includes(ql) ||
      (c.phone ?? "").includes(q) ||
      (c.email ?? "").toLowerCase().includes(ql) ||
      c.customer_reference.toLowerCase().includes(ql) ||
      (customerIdsByQuoteRef?.has(c.id) ?? false)
    );
  }), [customers, q, status, source, customerIdsByQuoteRef]);

  const exportCSV = async () => {
    try {
      const { getUserNamesByIds } = await import("@/lib/quotes-api");
      const names = await getUserNamesByIds(filtered.map((c) => c.user_id));
      downloadCSV(`customers-${new Date().toISOString().slice(0,10)}.csv`,
        filtered.map((c) => ({
          Reference: c.customer_reference,
          Name: c.guest_name,
          Phone: c.phone ?? "",
          Email: c.email ?? "",
          City: c.city ?? "",
          Status: c.status,
          Tags: (c.tags ?? []).join("|"),
          "Lead Source": c.lead_source ?? "",
          Quotes: c.total_quotes,
          Bookings: c.total_bookings,
          Revenue: c.total_revenue,
          "Created By": names[c.user_id] ?? "",
          "Created": c.created_at ? new Date(c.created_at).toISOString().slice(0,10) : "",
          "Last Interaction": c.updated_at ? new Date(c.updated_at).toISOString().slice(0,10) : "",
          "Last Stay": c.last_stay_date ?? "",
          "Booking %": c.booking_probability,
          "Payment Status": c.payment_status ?? "",
          "Next Action": c.next_action ?? "",
        })));
      toast.success(`Exported ${filtered.length} customer${filtered.length === 1 ? "" : "s"}`);
    } catch (e: any) {
      toast.error(e?.message ?? "CSV export failed");
    }
  };

  return (
    <>
      <Topbar title="Customers" subtitle="Guest intelligence & CRM" />
      <div className="px-4 md:px-8 py-6 md:py-8 space-y-5 max-w-[1400px]">
        <div className="flex flex-col md:flex-row gap-2">
          <div className="flex items-center gap-2 flex-1 px-3 py-2.5 rounded-md bg-card border border-border">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input
              placeholder="Search name, phone, email, reference"
              value={q} onChange={(e) => setQ(e.target.value)}
              className="bg-transparent text-sm outline-none flex-1 placeholder:text-muted-foreground/60"
            />
          </div>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="bg-card border border-border rounded-md px-3 py-2 text-sm">
            <option value="All">All statuses</option>
            {CUSTOMER_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={source} onChange={(e) => setSource(e.target.value)} className="bg-card border border-border rounded-md px-3 py-2 text-sm">
            <option value="All">All sources</option>
            {LEAD_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <button onClick={exportCSV} className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-4 py-2 text-sm hover:border-gold/40">
            <Download className="h-4 w-4 text-gold" /> Export CSV
          </button>
        </div>

        <div className="luxe-card rounded-xl overflow-hidden">
          <div className="hidden md:grid grid-cols-12 gap-4 px-6 py-3 text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border bg-secondary/30">
            <div className="col-span-3">Guest</div>
            <div className="col-span-2">Contact</div>
            <div className="col-span-2">Status</div>
            <div className="col-span-1 text-right">Quotes</div>
            <div className="col-span-2 text-right">Revenue</div>
            <div className="col-span-1 text-right">Prob</div>
            <div className="col-span-1 text-right">Actions</div>
          </div>

          {isLoading && <div className="p-12 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-gold" /></div>}
          {!isLoading && filtered.length === 0 && (
            <div className="py-16 text-center text-sm text-muted-foreground">
              No customers yet — they appear automatically when you create quotes.
            </div>
          )}
          {filtered.map((c, i) => (
            <motion.div key={c.id} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.02 }}
              className="grid grid-cols-1 md:grid-cols-12 gap-2 md:gap-4 px-4 md:px-6 py-4 border-b border-border/60 last:border-0 hover:bg-secondary/40 transition">
              <Link to="/customers/$id" params={{ id: c.id }} className="md:col-span-3 min-w-0">
                <div className="text-sm font-medium flex items-center gap-2">
                  {c.total_bookings > 0 && <Star className="h-3 w-3 fill-gold text-gold" />}
                  {c.guest_name}
                </div>
                <div className="text-[11px] font-mono text-muted-foreground">{c.customer_reference}</div>
              </Link>
              <div className="md:col-span-2 text-xs text-muted-foreground">
                <div>{c.phone}</div>
                {c.email && <div className="truncate">{c.email}</div>}
              </div>
              <div className="md:col-span-2">
                <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px]",
                  customerStatusStyles[c.status] ?? "bg-muted text-muted-foreground border-border")}>{c.status}</span>
              </div>
              <div className="md:col-span-1 text-right text-sm tabular-nums">{c.total_quotes}</div>
              <div className="md:col-span-2 text-right text-sm font-medium tabular-nums">
                ₹{Number(c.total_revenue).toLocaleString("en-IN")}
              </div>
              <div className="md:col-span-1 text-right text-xs text-gold">{c.booking_probability}%</div>
              <div className="md:col-span-1 flex items-center justify-end gap-1">
                {c.phone && (
                  <>
                    <a
                      href={`tel:${c.phone.replace(/\s+/g, "")}`}
                      onClick={(e) => e.stopPropagation()}
                      className="p-1.5 rounded text-muted-foreground hover:text-gold hover:bg-gold-soft transition"
                      title="Call"
                    >
                      <Phone className="h-3.5 w-3.5" />
                    </a>
                    <a
                      href={`https://wa.me/${c.phone.replace(/[^0-9]/g, "")}`}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="p-1.5 rounded text-muted-foreground hover:text-success hover:bg-success/10 transition"
                      title="WhatsApp"
                    >
                      <MessageCircle className="h-3.5 w-3.5" />
                    </a>
                  </>
                )}
                <Link
                  to="/generate"
                  search={{ customerId: c.id }}
                  onClick={(e) => e.stopPropagation()}
                  className="p-1.5 rounded text-muted-foreground hover:text-gold hover:bg-gold-soft transition"
                  title="Create quote for this guest"
                >
                  <FilePlus className="h-3.5 w-3.5" />
                </Link>
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
            </motion.div>
          ))}
        </div>
      </div>
    </>
  );
}
