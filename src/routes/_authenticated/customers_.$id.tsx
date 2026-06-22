import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listLeadActivitiesByCustomer } from "@/lib/leads.functions";
import { Topbar } from "@/components/topbar";
import { getCustomer, listCustomerQuotes, updateCustomer } from "@/lib/customers-api";
import { listCustomerBookings } from "@/lib/bookings-api";
import { DEFAULT_TAGS, LEAD_SOURCES, bookingStatusStyles } from "@/lib/mock-data";
import { useMasterData } from "@/hooks/use-master-data";
import { useRealtimeInvalidate } from "@/hooks/use-realtime";
import { StatusPill } from "@/components/status-pill";
import { CustomerEditDialog } from "@/components/customer-edit-dialog";
import {
  ArrowLeft, Loader2, Phone, Mail, MapPin, Briefcase, Calendar, Star,
  FilePlus, MessageCircle, Pencil, BedDouble,
} from "lucide-react";
import { CustomerDocumentsCard } from "@/components/customer-documents-card";
import { cn, toLocalYMD } from "@/lib/utils";
import { toast } from "sonner";
import { phoneToWaDigits } from "@/lib/phone";

export const Route = createFileRoute("/_authenticated/customers_/$id")({
  component: CustomerDetail,
});

function CustomerDetail() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  useRealtimeInvalidate(
    ["customers", "quotes", "bookings"],
    [["customer", id], ["customer-quotes", id], ["customer-bookings", id]],
    `cust-${id}`,
  );

  const { data: c, isLoading } = useQuery({ queryKey: ["customer", id], queryFn: () => getCustomer(id) });
  const { data: quotes = [] } = useQuery({ queryKey: ["customer-quotes", id], queryFn: () => listCustomerQuotes(id), enabled: !!c });
  const { data: bookings = [] } = useQuery({ queryKey: ["customer-bookings", id], queryFn: () => listCustomerBookings(id), enabled: !!c });
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
  const [editOpen, setEditOpen] = useState(false);
  const { values: leadSources } = useMasterData("lead_source", [...LEAD_SOURCES]);
  const { values: tags } = useMasterData("tag", [...DEFAULT_TAGS]);
  useEffect(() => { if (c) setNotes(c.internal_notes ?? ""); }, [c]);

  const save = useMutation({
    mutationFn: (patch: any) => updateCustomer(id, patch),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["customer", id] }); toast.success("Saved"); },
    onError: (e: any) => toast.error(e.message),
  });

  if (isLoading || !c) {
    return <div className="p-20 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-gold" /></div>;
  }

  // Booked Revenue = sum of bookings.amount for non-cancelled bookings
  const bookedRevenue = bookings
    .filter((b: any) => b.status !== "Cancelled")
    .reduce((s: number, b: any) => s + Number(b.amount || 0), 0);
  const bookingsCount = bookings.filter((b: any) => b.status !== "Cancelled").length;
  const conversion = c.total_quotes ? Math.round((bookingsCount / c.total_quotes) * 100) : 0;
  const aov = bookingsCount ? Math.round(bookedRevenue / bookingsCount) : 0;
  const repeat = bookingsCount > 1;
  const lifetimeQuoted = quotes.reduce((s: number, q: any) => s + Number(q.total ?? 0), 0);
  const latestQuote = quotes[0] as any | undefined;
  // Last stay = most recent past/completed booking check_out (never future)
  const today = toLocalYMD();
  const lastStay = bookings
    .filter((b: any) => b.status !== "Cancelled" && (b.status === "Stay Completed" || b.check_out < today))
    .map((b: any) => b.check_out)
    .sort()
    .pop() ?? null;

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
                <div className="min-w-0 flex-1">
                  <h2 className="font-display text-3xl flex items-center gap-2">
                    {repeat && <Star className="h-5 w-5 fill-gold text-gold" />}
                    {c.guest_name}
                  </h2>
                  {/* Tags as primary indicator — directly under the name */}
                  <div className="flex items-center gap-1.5 flex-wrap mt-2">
                    {(c.tags ?? []).length === 0 ? (
                      <span className="text-[11px] text-muted-foreground italic">No tags · use Tags section below</span>
                    ) : (
                      (c.tags ?? []).map((t) => (
                        <span key={t} className="inline-flex items-center rounded-full border border-gold/40 bg-gold-soft text-gold px-2.5 py-0.5 text-[11px]">
                          {t}
                        </span>
                      ))
                    )}
                  </div>
                  <div className="mt-3 space-y-1 text-sm text-muted-foreground">
                    {c.phone && <div className="flex items-center gap-2"><Phone className="h-3.5 w-3.5" />{c.phone}</div>}
                    {c.email && <div className="flex items-center gap-2"><Mail className="h-3.5 w-3.5" />{c.email}</div>}
                    {(c.city || c.country) && <div className="flex items-center gap-2"><MapPin className="h-3.5 w-3.5" />{[c.city, c.state, c.country].filter(Boolean).join(", ")}</div>}
                    {c.company_name && <div className="flex items-center gap-2"><Briefcase className="h-3.5 w-3.5" />{c.company_name}{c.gst_number ? ` · GST ${c.gst_number}` : ""}</div>}
                    {(c.emergency_contact_name || c.emergency_contact_phone) && (
                      <div className="flex items-center gap-2 text-warning">
                        <span className="text-[10px] uppercase tracking-wider">Emergency</span>
                        <span className="text-foreground">{c.emergency_contact_name || "—"}{c.emergency_contact_phone ? ` · ${c.emergency_contact_phone}` : ""}</span>
                      </div>
                    )}
                    <div className="flex items-center gap-2 text-[11px]">
                      <Calendar className="h-3.5 w-3.5" />
                      Lead: <span className="text-foreground">{c.lead_source ?? "Direct"}</span>
                      <span className="text-muted-foreground/60">·</span>
                      Created {new Date(c.first_contact_date).toLocaleDateString("en-IN")}
                      {createdBy && <><span className="text-muted-foreground/60">·</span>by <span className="text-foreground">{createdBy}</span></>}
                    </div>
                  </div>
                </div>
              </div>
              {/* Neatly aligned action row */}
              <div className="mt-5 flex items-center gap-2 flex-wrap">
                <button onClick={() => setEditOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-xs hover:border-gold/40">
                  <Pencil className="h-3.5 w-3.5" /> Edit
                </button>
                {c.phone && (
                  <>
                    <a href={`tel:${c.phone.replace(/\s+/g, "")}`}
                      className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-xs hover:border-gold/40">
                      <Phone className="h-3.5 w-3.5" /> Call
                    </a>
                    <a href={`https://wa.me/${phoneToWaDigits(c.phone)}`} target="_blank" rel="noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-xs text-success hover:border-success/40">
                      <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
                    </a>
                  </>
                )}
                <Link to="/generate" search={{ customerId: c.id }}
                  className="inline-flex items-center gap-1.5 rounded-md gold-gradient px-3 py-2 text-xs font-medium text-charcoal hover:shadow-[0_0_18px_oklch(0.82_0.13_82/0.35)]">
                  <FilePlus className="h-3.5 w-3.5" /> New Quote
                </Link>
                <Link to="/bookings/new" search={{ customerId: c.id, fromQuoteId: undefined } as any}
                  className="inline-flex items-center gap-1.5 rounded-md border border-gold/40 bg-gold-soft text-gold px-3 py-2 text-xs font-medium hover:bg-gold/20">
                  <BedDouble className="h-3.5 w-3.5" /> New Booking
                </Link>
              </div>
            </div>

            {/* P9 — Hide stat groups when the section has no data */}
            {(quotes.length > 0 || bookingsCount > 0) && (
              <div className="space-y-3">
                {quotes.length > 0 && (
                  <div>
                    <h4 className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Quote Summary</h4>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <Stat label="Total Quotes" value={c.total_quotes} />
                      <Stat label="Conversion" value={`${conversion}%`} />
                      <Stat label="Lifetime Quoted" value={`₹${Number(lifetimeQuoted).toLocaleString("en-IN")}`} accent />
                      <Stat label="Latest Quote" value={latestQuote ? <span className="font-mono text-base">{latestQuote.reference_code}</span> : "—"} />
                    </div>
                  </div>
                )}
                {bookingsCount > 0 && (
                  <div>
                    <h4 className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Booking Summary</h4>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <Stat label="Total Bookings" value={bookingsCount} />
                      <Stat label="Booked Revenue" value={`₹${bookedRevenue.toLocaleString("en-IN")}`} accent />
                      <Stat label="Avg Booking" value={aov ? `₹${aov.toLocaleString("en-IN")}` : "—"} />
                      <Stat label="Last Stay" value={lastStay ? new Date(lastStay).toLocaleDateString("en-IN") : "—"} />
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="luxe-card rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-border flex items-center justify-between">
                <h3 className="font-display text-lg">Quotes</h3>
                <span className="text-xs text-muted-foreground">{quotes.length} total</span>
              </div>
              {quotes.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground">No quotes yet.</div>
              ) : (
                quotes.map((q: any) => (
                  <Link key={q.id} to="/quote/$id" params={{ id: q.id }}
                    className="grid grid-cols-1 md:grid-cols-12 gap-2 md:gap-4 px-5 py-3 border-b border-border/50 last:border-0 hover:bg-secondary/40 text-sm">
                    <div className="md:col-span-3 font-mono text-xs text-muted-foreground">{q.reference_code}</div>
                    <div className="md:col-span-4">{new Date(q.check_in + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })} – {new Date(q.check_out + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</div>
                    <div className="md:col-span-3 font-medium tabular-nums">₹{Number(q.total).toLocaleString("en-IN")}</div>
                    <div className="md:col-span-2"><StatusPill status={q.status} /></div>
                  </Link>
                ))
              )}
            </div>

            <div className="luxe-card rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-border flex items-center justify-between">
                <h3 className="font-display text-lg flex items-center gap-2"><BedDouble className="h-4 w-4 text-gold" /> Bookings</h3>
                <span className="text-xs text-muted-foreground">{bookings.length} total</span>
              </div>
              {bookings.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground">No bookings yet.</div>
              ) : (
                bookings.map((b: any) => (
                  <Link key={b.id} to="/bookings/$id" params={{ id: b.id }}
                    className="grid grid-cols-1 md:grid-cols-12 gap-2 md:gap-4 px-5 py-3 border-b border-border/50 last:border-0 hover:bg-secondary/40 text-sm">
                    <div className="md:col-span-3 font-mono text-xs text-muted-foreground">{b.booking_reference}</div>
                    <div className="md:col-span-4">{new Date(b.check_in + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })} – {new Date(b.check_out + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</div>
                    <div className="md:col-span-3 font-medium tabular-nums">₹{Number(b.amount).toLocaleString("en-IN")}</div>
                    <div className="md:col-span-2">
                      <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[10px]", bookingStatusStyles[b.status as keyof typeof bookingStatusStyles])}>{b.status}</span>
                    </div>
                  </Link>
                ))
              )}
              <div className="px-5 py-3 border-t border-border">
                <Link to="/bookings/new" search={{ customerId: c.id, fromQuoteId: undefined } as any}
                  className="text-xs text-gold hover:underline">+ New Booking for this customer</Link>
              </div>
            </div>

            <CustomerDocumentsCard customerId={c.id} />

            {/* P10 — Stacked order: Internal Notes ↓ Tag ↓ Lead Source */}
            <div className="luxe-card rounded-xl p-5">
              <h3 className="font-display text-lg mb-3">Internal Notes</h3>
              <textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)}
                onBlur={() => notes !== c.internal_notes && save.mutate({ internal_notes: notes })}
                placeholder="Private notes — never shown to guest…"
                className="w-full bg-input/60 border border-border rounded-md px-3 py-2.5 text-sm resize-none" />
              <p className="text-[10px] text-muted-foreground mt-1">Hidden from PDFs, WhatsApp messages, images, and CSV exports.</p>
            </div>

            <div className="luxe-card rounded-xl p-5">
              <h3 className="font-display text-lg mb-3">Tag</h3>
              <div className="flex flex-wrap gap-2">
                {tags.map((t) => (
                  <button key={t} onClick={() => toggleTag(t)}
                    className={cn("px-3 py-1 rounded-full text-xs border transition",
                      c.tags.includes(t) ? "border-gold/50 bg-gold-soft text-gold" : "border-border bg-card text-muted-foreground hover:text-foreground hover:border-gold/30")}>
                    {t}
                  </button>
                ))}
              </div>
            </div>

            <div className="luxe-card rounded-xl p-5">
              <h3 className="font-display text-lg mb-3">Lead Source</h3>
              <select value={c.lead_source ?? "Direct"} onChange={(e) => save.mutate({ lead_source: e.target.value })}
                className="w-full bg-input/60 border border-border rounded-md px-3 py-2 text-sm">
                {leadSources.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>

          <div className="space-y-4">
            {/* Quick-glance contact / company panel (right rail) */}
            <Panel title="Contact">
              <div className="space-y-1 text-xs text-muted-foreground">
                {c.phone && <div className="flex items-center gap-2"><Phone className="h-3 w-3" />{c.phone}</div>}
                {c.email && <div className="flex items-center gap-2"><Mail className="h-3 w-3" />{c.email}</div>}
                {!c.phone && !c.email && <div className="italic">No contact details</div>}
              </div>
            </Panel>

            <LeadTimeline customerId={c.id} />
          </div>
        </div>
      </div>

      <CustomerEditDialog open={editOpen} onClose={() => setEditOpen(false)} customer={c} />
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

function LeadTimeline({ customerId }: { customerId: string }) {
  const fetchActs = useServerFn(listLeadActivitiesByCustomer);
  const { data: acts = [], isLoading } = useQuery({
    queryKey: ["lead-activities", customerId],
    queryFn: () => fetchActs({ data: { customer_id: customerId } }),
  });
  if (isLoading) return null;
  if (!acts.length) return null;
  return (
    <Panel title="Lead Activity">
      <div className="space-y-2 max-h-72 overflow-y-auto">
        {acts.map((a: any) => (
          <div key={a.id} className="text-[11px] leading-snug border-l-2 border-gold/40 pl-2">
            <div className="text-muted-foreground">
              {new Date(a.created_at).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
              {a.actor_name ? ` · ${a.actor_name}` : ""}
            </div>
            <div>{a.summary ?? a.action}</div>
          </div>
        ))}
      </div>
    </Panel>
  );
}
