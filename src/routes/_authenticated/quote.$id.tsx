import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Topbar } from "@/components/topbar";
import { StatusPill } from "@/components/status-pill";
import { QUOTE_STATUSES, earlyCheckInLabel, lateCheckOutLabel, type QuoteStatus } from "@/lib/mock-data";
import {
  getQuote, listActivities, setStatus, deleteQuote, duplicateQuote,
  addFollowup, buildWhatsAppLink, logWhatsApp, logPdf, calc,
} from "@/lib/quotes-api";
import { listQuoteItems } from "@/lib/quote-items-api";
import { shareQuoteImage } from "@/lib/share-quote";
import { useRealtimeInvalidate } from "@/hooks/use-realtime";
import {
  ArrowLeft, MessageCircle, Loader2, Copy, Trash2, Bell, User, Phone, Mail, CalendarDays,
  Star, Clock, Pencil, CheckCircle2, Share2, Printer, BedDouble,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useUserRole } from "@/hooks/use-role";

export const Route = createFileRoute("/_authenticated/quote/$id")({
  component: QuoteDetail,
});

function QuoteDetail() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { isAdmin } = useUserRole();

  useRealtimeInvalidate(["quotes", "quote_activities"], [["quote", id], ["activities", id], "quotes"], `quote-${id}`);

  const { data: q, isLoading } = useQuery({ queryKey: ["quote", id], queryFn: () => getQuote(id) });
  const { data: activities = [] } = useQuery({
    queryKey: ["activities", id],
    queryFn: () => listActivities(id),
    enabled: !!q,
  });

  const status = useMutation({
    mutationFn: (s: QuoteStatus) => setStatus(id, s),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["quote", id] });
      qc.invalidateQueries({ queryKey: ["activities", id] });
      qc.invalidateQueries({ queryKey: ["quotes"] });
      toast.success("Status updated");
    },
  });
  const dup = useMutation({
    mutationFn: () => duplicateQuote(id),
    onSuccess: (nq) => {
      toast.success("Duplicated");
      navigate({ to: "/quote/$id", params: { id: nq.id } });
    },
  });
  const del = useMutation({
    mutationFn: () => deleteQuote(id),
    onSuccess: () => {
      toast.success("Deleted");
      navigate({ to: "/history" });
    },
  });

  const cardRef = useRef<HTMLDivElement>(null);

  const [followDate, setFollowDate] = useState(() => {
    const d = new Date(Date.now() + 86400000);
    return d.toISOString().slice(0, 16);
  });
  const [followNote, setFollowNote] = useState("");
  const follow = useMutation({
    mutationFn: () => addFollowup(id, new Date(followDate).toISOString(), followNote || null),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["activities", id] });
      qc.invalidateQueries({ queryKey: ["followups"] });
      setFollowNote("");
      toast.success("Follow-up scheduled");
    },
  });

  if (isLoading)
    return (
      <div className="p-20 flex justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-gold" />
      </div>
    );
  if (!q)
    return (
      <div className="p-20 text-center">
        <p className="text-sm text-muted-foreground">Quote not found.</p>
        <Link to="/history" className="text-gold text-sm hover:underline mt-2 inline-block">
          Back to history
        </Link>
      </div>
    );

  const copyQuoteText = async () => {
    try {
      const link = buildWhatsAppLink(q);
      const text = decodeURIComponent(link.split("?text=")[1] ?? "");
      await navigator.clipboard.writeText(text);
      toast.success("Quote text copied");
    } catch {
      toast.error("Could not copy");
    }
  };

  return (
    <>
      <Topbar title="Quote Detail" subtitle={q.reference_code} />
      <div className="px-4 md:px-8 py-6 md:py-8 max-w-[1400px] space-y-6 print:p-0">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 print:hidden">
          <Link to="/history" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> Back
          </Link>
          <div className="flex flex-wrap gap-2">
            <a
              href={buildWhatsAppLink(q)}
              target="_blank"
              rel="noreferrer"
              onClick={() => logWhatsApp(id)}
              className="inline-flex items-center gap-2 rounded-md bg-success/15 border border-success/40 text-success px-4 py-2.5 text-sm hover:bg-success/20"
            >
              <MessageCircle className="h-4 w-4" /> WhatsApp
            </a>
            <button
              onClick={() => cardRef.current && shareQuoteImage(cardRef.current, q)}
              className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-4 py-2.5 text-sm hover:border-gold/40"
              title="Share image via WhatsApp, Gmail, Telegram, SMS…"
            >
              <Share2 className="h-4 w-4 text-gold" /> Share Image
            </button>
            <button
              onClick={() => { logPdf(id); window.print(); }}
              className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-4 py-2.5 text-sm hover:border-gold/40"
            >
              <Printer className="h-4 w-4 text-gold" /> PDF
            </button>
            <Link
              to="/quote/$id/edit"
              params={{ id }}
              className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-4 py-2.5 text-sm hover:border-gold/40"
            >
              <Pencil className="h-4 w-4 text-gold" /> Edit
            </Link>
            <button onClick={copyQuoteText} className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-4 py-2.5 text-sm hover:border-gold/40">
              <Copy className="h-4 w-4 text-gold" /> Copy
            </button>
            <button onClick={() => dup.mutate()} className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-4 py-2.5 text-sm hover:border-gold/40">
              <Copy className="h-4 w-4 text-gold" /> Duplicate
            </button>
            {!["Confirmed", "Completed", "Converted"].includes(q.status) && (
              <button
                onClick={() => status.mutate("Confirmed")}
                className="inline-flex items-center gap-2 rounded-md gold-gradient px-4 py-2.5 text-sm text-charcoal font-medium"
              >
                <CheckCircle2 className="h-4 w-4" /> Confirm
              </button>
            )}
            <Link
              to="/bookings/new"
              search={{ customerId: q.customer_id ?? undefined, fromQuoteId: q.id } as any}
              className="inline-flex items-center gap-2 rounded-md border border-gold/40 bg-gold-soft text-gold px-4 py-2.5 text-sm font-medium hover:bg-gold/20"
            >
              <BedDouble className="h-4 w-4" /> Convert to Booking
            </Link>
            {isAdmin && (
              <button
                onClick={() => { if (confirm("Delete this quote?")) del.mutate(); }}
                className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-4 py-2.5 text-sm text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="h-4 w-4" /> Delete
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6 print:block">
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            <div ref={cardRef}>
              <QuoteCard q={q} />
            </div>
          </motion.div>

          <div className="space-y-4 print:hidden">
            <div className="luxe-card rounded-xl p-5">
              <h4 className="font-display text-lg mb-3">Status</h4>
              <div className="mb-3"><StatusPill status={q.status} /></div>
              <div className="grid grid-cols-2 gap-2">
                {QUOTE_STATUSES.map((s) => (
                  <button
                    key={s}
                    onClick={() => status.mutate(s)}
                    disabled={s === q.status}
                    className={cn(
                      "rounded-md border px-2 py-1.5 text-xs transition",
                      s === q.status
                        ? "border-gold/50 bg-gold-soft text-gold"
                        : "border-border bg-card text-muted-foreground hover:text-foreground hover:border-gold/30",
                    )}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            <div className="luxe-card rounded-xl p-5">
              <h4 className="font-display text-lg mb-3 flex items-center gap-2">
                <Bell className="h-4 w-4 text-gold" /> Schedule Follow-up
              </h4>
              <input
                type="datetime-local"
                value={followDate}
                onChange={(e) => setFollowDate(e.target.value)}
                className="w-full bg-input/60 border border-border rounded-md px-3 py-2 text-sm mb-2"
              />
              <input
                placeholder="Note (optional)"
                value={followNote}
                onChange={(e) => setFollowNote(e.target.value)}
                className="w-full bg-input/60 border border-border rounded-md px-3 py-2 text-sm mb-3"
              />
              <button
                onClick={() => follow.mutate()}
                disabled={follow.isPending}
                className="w-full rounded-md gold-gradient px-4 py-2.5 text-sm font-medium text-charcoal disabled:opacity-60"
              >
                Schedule
              </button>
            </div>

            <div className="luxe-card rounded-xl p-5">
              <h4 className="font-display text-lg mb-3 flex items-center gap-2">
                <Clock className="h-4 w-4 text-gold" /> Activity
              </h4>
              <div className="space-y-3 max-h-80 overflow-auto">
                {activities.length === 0 && (
                  <p className="text-xs text-muted-foreground">No activity yet.</p>
                )}
                {activities.map((a: any) => (
                  <div key={a.id} className="flex gap-3 text-xs">
                    <div className="h-2 w-2 rounded-full bg-gold mt-1.5 shrink-0" />
                    <div className="flex-1">
                      <div className="text-foreground">{a.description}</div>
                      <div className="text-[10px] text-muted-foreground mt-0.5">
                        {new Date(a.created_at).toLocaleString("en-IN")}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function QuoteCard({ q }: { q: any }) {
  const whyStay = [
    "Free High-Speed Wi-Fi",
    "Walkable Distance to Beach",
    "Close to Major Sightseeing Attractions",
    "Comfortable AC Rooms",
    "Smart TV Entertainment",
    "24/7 Reception Assistance",
    "Daily Housekeeping Service",
  ];
  const fmtDate = (s: string) =>
    new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  return (
    <div className="luxe-card rounded-2xl p-6 md:p-10 relative overflow-hidden print:border-0 print:shadow-none print:bg-white print:text-black">
      <div className="absolute -right-32 -top-32 h-80 w-80 rounded-full bg-gold/5 blur-3xl pointer-events-none print:hidden" />

      <div className="relative flex flex-col md:flex-row md:items-start md:justify-between gap-4 pb-6 border-b border-border">
        <div className="flex items-center gap-4">
          <div className="h-14 w-14 rounded-md gold-gradient flex items-center justify-center">
            <span className="font-display text-2xl font-semibold text-charcoal">H</span>
          </div>
          <div>
            <div className="font-display text-xl">HOTEL EXCELLA</div>
            <div className="text-[10px] tracking-[0.3em] text-gold/80 uppercase">Boutique · Luxury · Stay</div>
          </div>
        </div>
        <div className="text-right">
          <h2 className="font-display text-4xl gold-text-gradient">QUOTE</h2>
          <div className="text-xs text-muted-foreground mt-1">{q.reference_code}</div>
          <div className="text-[10px] text-muted-foreground mt-0.5">
            Issued: {new Date(q.created_at).toLocaleDateString("en-IN")}
          </div>
        </div>
      </div>

      <div className="relative grid grid-cols-1 md:grid-cols-2 gap-6 py-6 border-b border-border">
        <div>
          <h4 className="text-[10px] uppercase tracking-[0.25em] text-gold mb-3">Guest Details</h4>
          <div className="space-y-1.5 text-sm">
            <div className="flex items-center gap-2"><User className="h-3.5 w-3.5 text-muted-foreground" />{q.guest_name}</div>
            <div className="flex items-center gap-2"><Phone className="h-3.5 w-3.5 text-muted-foreground" />{q.phone}</div>
            {q.email && <div className="flex items-center gap-2"><Mail className="h-3.5 w-3.5 text-muted-foreground" />{q.email}</div>}
          </div>
        </div>
        <div>
          <h4 className="text-[10px] uppercase tracking-[0.25em] text-gold mb-3">Stay Details</h4>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <div className="flex items-center gap-1.5"><CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />{fmtDate(q.check_in)}</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">Check-in · 1:00 PM</div>
            </div>
            <div>
              <div className="flex items-center gap-1.5"><CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />{fmtDate(q.check_out)}</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">Check-out · 11:00 AM</div>
            </div>
            <div className="col-span-2 text-xs text-muted-foreground">
              {q.group_size} · {q.nights} Night{q.nights > 1 ? "s" : ""}
            </div>
          </div>
        </div>
      </div>

      <div className="relative py-6 border-b border-border">
        <div className="grid grid-cols-[1fr_auto] gap-2 text-[10px] uppercase tracking-[0.25em] text-muted-foreground pb-3">
          <div>Description</div>
          <div>Amount</div>
        </div>
        {(() => {
          const c = calc(q);
          return (
            <>
              <Row desc={`${q.room_type} × ${q.rooms} (${q.nights} Night${q.nights > 1 ? "s" : ""})`} amount={c.roomTariff} />
              {q.extra_bed > 0 && <Row desc={`Extra Bed × ${q.extra_bed}`} amount={c.extraBed} />}
              {q.early_check_in && q.early_check_in_slot && (
                <Row desc={`Early Check-in (${earlyCheckInLabel(q.early_check_in_slot)})`} amount={c.earlyCheck} />
              )}
              {q.late_check_out && q.late_check_out_slot && (
                <Row desc={`Late Check-out (${lateCheckOutLabel(q.late_check_out_slot)})`} amount={c.lateCheck} />
              )}
              {q.pet_charges && <Row desc="Pet Charges" amount={c.pet} />}
              {q.extra_adults > 0 && (
                <Row desc={`Extra Adults × ${q.extra_adults} (incl. mattress & breakfast)`} amount={c.extraAdults} />
              )}
              {q.drivers > 0 && (
                <Row desc={`Drivers × ${q.drivers} (incl. mattress & breakfast)`} amount={c.driversCharge} />
              )}
              {!q.breakfast_included && q.extra_breakfast_guests > 0 && (
                <Row desc={`Extra Breakfast × ${q.extra_breakfast_guests}`} amount={c.extraBreakfast} />
              )}
              {Number(q.discount) > 0 && <Row desc="Discount" amount={-Number(q.discount)} />}
              <Row desc="Taxes & Fees (5%)" amount={Number(q.taxes)} />
            </>
          );
        })()}
      </div>

      <div className="relative py-6 border-b border-border flex items-baseline justify-between">
        <span className="font-display text-2xl">Total Amount</span>
        <span className="font-display text-3xl gold-text-gradient">
          ₹{Number(q.total).toLocaleString("en-IN")}
        </span>
      </div>

      <div className="relative py-6">
        <h4 className="text-[10px] uppercase tracking-[0.25em] text-gold mb-3">🌟 Why Stay with Hotel Excella?</h4>
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-y-1.5 gap-x-4 text-sm">
          {whyStay.map((label) => (
            <li key={label} className="flex items-start gap-2">
              <CheckCircle2 className="h-3.5 w-3.5 text-gold mt-0.5 shrink-0" />
              <span>{label}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="relative pt-6 border-t border-border text-center">
        <p className="font-display italic text-lg text-gold/90">
          We look forward to hosting you at Hotel Excella
        </p>
        <div className="flex justify-center gap-1 mt-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Star key={i} className="h-4 w-4 fill-gold text-gold" />
          ))}
        </div>
        <p className="text-[10px] text-muted-foreground mt-3">
          Quote valid for 7 days · Standard check-in 1:00 PM · Standard check-out 11:00 AM
        </p>
      </div>
    </div>
  );
}

function Row({ desc, amount }: { desc: string; amount: number }) {
  return (
    <div className="grid grid-cols-[1fr_auto] gap-2 py-2 text-sm border-t border-border/40 first:border-0">
      <div>{desc}</div>
      <div className={cn("tabular-nums", amount < 0 && "text-success")}>
        {amount < 0 ? "-" : ""}₹{Math.abs(Number(amount)).toLocaleString("en-IN")}
      </div>
    </div>
  );
}
