import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Topbar } from "@/components/topbar";
import { getCustomer, listCustomerQuotes, updateCustomer } from "@/lib/customers-api";
import {
  CUSTOMER_STATUSES, customerStatusStyles, DEFAULT_TAGS, LEAD_SOURCES,
  NEXT_ACTIONS, PAYMENT_STATUSES, paymentStatusStyles, BOOKING_PROBABILITIES,
} from "@/lib/mock-data";
import { useRealtimeInvalidate } from "@/hooks/use-realtime";
import { StatusPill } from "@/components/status-pill";
import {
  ArrowLeft, Loader2, Phone, Mail, MapPin, Briefcase, Calendar, Star, TrendingUp,
  FilePlus, MessageCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/customers_/$id")({
  component: CustomerDetail,
});

function CustomerDetail() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  useRealtimeInvalidate(["customers", "quotes"], [["customer", id], ["customer-quotes", id]], `cust-${id}`);

  const { data: c, isLoading } = useQuery({ queryKey: ["customer", id], queryFn: () => getCustomer(id) });
  const { data: quotes = [] } = useQuery({ queryKey: ["customer-quotes", id], queryFn: () => listCustomerQuotes(id), enabled: !!c });
  const { data: creators = {} } = useQuery({
    queryKey: ["customer-creator", c?.user_id],
    queryFn: async () => {
      const { getUserNamesByIds } = await import("@/lib/quotes-api");
      return getUserNamesByIds(c?.user_id ? [c.user_id] : []);
    },
    enabled: !!c?.user_id,
  });
  const createdBy = c?.user_id ? creators[c.user_id] : null;

  const [notes, setNotes] = useState("");
  useEffect(() => { if (c) setNotes(c.internal_notes ?? ""); }, [c]);


  const save = useMutation({
    mutationFn: (patch: any) => updateCustomer(id, patch),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["customer", id] }); toast.success("Saved"); },
    onError: (e: any) => toast.error(e.message),
  });

  if (isLoading || !c) {
    return <div className="p-20 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-gold" /></div>;
  }

  const conversion = c.total_quotes ? Math.round((c.total_bookings / c.total_quotes) * 100) : 0;
  const aov = c.total_bookings ? Math.round(Number(c.total_revenue) / c.total_bookings) : 0;
  const repeat = c.total_bookings > 1;
  const lifetimeQuoted = quotes.reduce((s: number, q: any) => s + Number(q.total ?? 0), 0);
  const latestQuote = quotes[0] as any | undefined;

  const toggleTag = (tag: string) => {
    const next = c.tags.includes(tag) ? c.tags.filter((t) => t !== tag) : [...c.tags, tag];
    save.mutate({ tags: next });
  };

  return (
    <>
      <Topbar title={c.guest_name} subtitle={c.customer_reference} />
      <div className="px-4 md:px-8 py-6 md:py-8 max-w-[1400px] space-y-6">
        <Link to="/customers" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> All customers
        </Link>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
          <div className="space-y-6">
            <div className="luxe-card rounded-xl p-6">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                  <h2 className="font-display text-3xl flex items-center gap-2">
                    {repeat && <Star className="h-5 w-5 fill-gold text-gold" />}
                    {c.guest_name}
                  </h2>
                  {repeat && <div className="text-xs text-gold mt-1">★ Returning Guest</div>}
                  <div className="mt-3 space-y-1 text-sm text-muted-foreground">
                    {c.phone && <div className="flex items-center gap-2"><Phone className="h-3.5 w-3.5" />{c.phone}</div>}
                    {c.email && <div className="flex items-center gap-2"><Mail className="h-3.5 w-3.5" />{c.email}</div>}
                    {(c.city || c.country) && <div className="flex items-center gap-2"><MapPin className="h-3.5 w-3.5" />{[c.city, c.state, c.country].filter(Boolean).join(", ")}</div>}
                    {c.company_name && <div className="flex items-center gap-2"><Briefcase className="h-3.5 w-3.5" />{c.company_name}{c.gst_number ? ` · GST ${c.gst_number}` : ""}</div>}
                    <div className="flex items-center gap-2 text-[11px]">
                      <Calendar className="h-3.5 w-3.5" />
                      Lead source: <span className="text-foreground">{c.lead_source ?? "Direct"}</span>
                      <span className="text-muted-foreground/60">·</span>
                      Created {new Date(c.first_contact_date).toLocaleDateString("en-IN")}
                      {createdBy && <><span className="text-muted-foreground/60">·</span>by <span className="text-foreground">{createdBy}</span></>}
                    </div>
                  </div>

                </div>
                <div className="flex flex-col items-end gap-2">
                  <span className={cn("inline-flex items-center rounded-full border px-3 py-1 text-xs",
                    customerStatusStyles[c.status] ?? "bg-muted text-muted-foreground border-border")}>{c.status}</span>
                  <div className="flex items-center gap-2">
                    {c.phone && (
                      <>
                        <a href={`tel:${c.phone.replace(/\s+/g, "")}`}
                          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs hover:border-gold/40">
                          <Phone className="h-3 w-3" /> Call
                        </a>
                        <a href={`https://wa.me/${c.phone.replace(/[^0-9]/g, "")}`} target="_blank" rel="noreferrer"
                          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs text-success hover:border-success/40">
                          <MessageCircle className="h-3 w-3" /> WhatsApp
                        </a>
                      </>
                    )}
                    <Link to="/generate" search={{ customerId: c.id }}
                      className="inline-flex items-center gap-1.5 rounded-md gold-gradient px-3 py-1.5 text-xs font-medium text-charcoal hover:shadow-[0_0_18px_oklch(0.82_0.13_82/0.35)]">
                      <FilePlus className="h-3 w-3" /> Create Quote
                    </Link>
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Stat label="Total Quotes" value={c.total_quotes} />
              <Stat label="Bookings" value={c.total_bookings} />
              <Stat label="Conversion" value={`${conversion}%`} />
              <Stat
                label="Lifetime Quoted"
                value={`₹${Number(lifetimeQuoted).toLocaleString("en-IN")}`}
                accent
              />
              <Stat label="Booked Revenue" value={`₹${Number(c.total_revenue).toLocaleString("en-IN")}`} />
              <Stat label="Avg Booking" value={aov ? `₹${aov.toLocaleString("en-IN")}` : "—"} />
              <Stat
                label="Latest Quote"
                value={latestQuote ? <span className="font-mono text-base">{latestQuote.reference_code}</span> : "—"}
              />
              <Stat label="Last Stay" value={c.last_stay_date ? new Date(c.last_stay_date).toLocaleDateString("en-IN") : "—"} />
            </div>

            <div className="luxe-card rounded-xl p-5">
              <h3 className="font-display text-lg mb-3">Tags</h3>
              <div className="flex flex-wrap gap-2">
                {DEFAULT_TAGS.map((t) => (
                  <button key={t} onClick={() => toggleTag(t)}
                    className={cn("px-3 py-1 rounded-full text-xs border transition",
                      c.tags.includes(t) ? "border-gold/50 bg-gold-soft text-gold" : "border-border bg-card text-muted-foreground hover:text-foreground hover:border-gold/30")}>
                    {t}
                  </button>
                ))}
              </div>
            </div>

            <div className="luxe-card rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-border flex items-center justify-between">
                <h3 className="font-display text-lg">Quotes & Bookings</h3>
                <span className="text-xs text-muted-foreground">{quotes.length} total</span>
              </div>
              {quotes.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground">No quotes yet.</div>
              ) : (
                quotes.map((q: any) => (
                  <Link key={q.id} to="/quote/$id" params={{ id: q.id }}
                    className="grid grid-cols-1 md:grid-cols-12 gap-2 md:gap-4 px-5 py-3 border-b border-border/50 last:border-0 hover:bg-secondary/40 text-sm">
                    <div className="md:col-span-3 font-mono text-xs text-muted-foreground">{q.reference_code}</div>
                    <div className="md:col-span-4">{new Date(q.check_in).toLocaleDateString("en-IN")} – {new Date(q.check_out).toLocaleDateString("en-IN")}</div>
                    <div className="md:col-span-3 font-medium tabular-nums">₹{Number(q.total).toLocaleString("en-IN")}</div>
                    <div className="md:col-span-2"><StatusPill status={q.status} /></div>
                  </Link>
                ))
              )}
            </div>

            <div className="luxe-card rounded-xl p-5">
              <h3 className="font-display text-lg mb-3">Internal Notes</h3>
              <textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)}
                onBlur={() => notes !== c.internal_notes && save.mutate({ internal_notes: notes })}
                placeholder="Private notes — never shown to guest…"
                className="w-full bg-input/60 border border-border rounded-md px-3 py-2.5 text-sm resize-none" />
              <p className="text-[10px] text-muted-foreground mt-1">Hidden from PDFs, WhatsApp messages, images, and CSV exports.</p>
            </div>
          </div>

          <div className="space-y-4">
            <Panel title="Status">
              <select value={c.status} onChange={(e) => save.mutate({ status: e.target.value })} className="w-full bg-input/60 border border-border rounded-md px-3 py-2 text-sm">
                {CUSTOMER_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Panel>
            <Panel title="Lead Source">
              <select value={c.lead_source ?? "Direct"} onChange={(e) => save.mutate({ lead_source: e.target.value })} className="w-full bg-input/60 border border-border rounded-md px-3 py-2 text-sm">
                {LEAD_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Panel>
            <Panel title="Booking Probability">
              <div className="flex gap-2 flex-wrap">
                {BOOKING_PROBABILITIES.map((p) => (
                  <button key={p} onClick={() => save.mutate({ booking_probability: p })}
                    className={cn("px-3 py-1.5 rounded-md text-xs border",
                      c.booking_probability === p ? "border-gold/60 bg-gold-soft text-gold" : "border-border bg-card text-muted-foreground")}>
                    {p}%
                  </button>
                ))}
                <input type="number" min={0} max={100} value={c.booking_probability}
                  onChange={(e) => save.mutate({ booking_probability: Number(e.target.value) })}
                  className="w-16 bg-input/60 border border-border rounded-md px-2 py-1.5 text-xs" />
              </div>
            </Panel>
            <Panel title="Next Action">
              <select value={c.next_action ?? ""} onChange={(e) => save.mutate({ next_action: e.target.value || null })} className="w-full bg-input/60 border border-border rounded-md px-3 py-2 text-sm">
                <option value="">—</option>
                {NEXT_ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
              <input type="date" value={c.next_followup_date ?? ""} onChange={(e) => save.mutate({ next_followup_date: e.target.value || null })}
                className="w-full mt-2 bg-input/60 border border-border rounded-md px-3 py-2 text-sm" />
            </Panel>
            <Panel title="Payment Status">
              <select value={c.payment_status ?? "None"} onChange={(e) => save.mutate({ payment_status: e.target.value })} className="w-full bg-input/60 border border-border rounded-md px-3 py-2 text-sm">
                {PAYMENT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <div className="mt-2">
                <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px]",
                  paymentStatusStyles[c.payment_status ?? "None"])}>{c.payment_status ?? "None"}</span>
              </div>
            </Panel>
          </div>
        </div>
      </div>
    </>
  );
}

function Stat({ label, value, accent }: { label: string; value: any; accent?: boolean }) {
  return (
    <div className={cn("luxe-card rounded-xl p-4", accent && "ring-1 ring-gold/30")}>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="font-display text-2xl mt-1">{value}</div>
    </div>
  );
}
function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="luxe-card rounded-xl p-4">
      <h4 className="text-xs uppercase tracking-wider text-muted-foreground mb-2">{title}</h4>
      {children}
    </div>
  );
}
