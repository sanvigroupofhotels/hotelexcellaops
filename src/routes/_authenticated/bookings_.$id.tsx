import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Topbar } from "@/components/topbar";
import { getBooking, setBookingStatus, deleteBooking } from "@/lib/bookings-api";
import { listBookingItems } from "@/lib/booking-items-api";
import { getCustomer } from "@/lib/customers-api";
import { BOOKING_STATUSES, bookingStatusStyles, type BookingStatus } from "@/lib/mock-data";
import { useRealtimeInvalidate } from "@/hooks/use-realtime";
import { useUserRole } from "@/hooks/use-role";
import {
  confirmationMessage, paymentReminderMessage, checkInWelcomeMessage,
  checkOutThankYouMessage, bookingWhatsAppLink,
} from "@/lib/booking-messages";
import {
  ArrowLeft, Loader2, Trash2, BedDouble, Phone, Mail, CalendarDays, User,
  MessageCircle, Send, Wallet, HandPlatter, Heart,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/bookings_/$id")({
  component: BookingDetail,
});

function BookingDetail() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { isAdmin } = useUserRole();
  useRealtimeInvalidate(["bookings"], [["booking", id], "bookings"], `booking-${id}`);

  const { data: b, isLoading } = useQuery({ queryKey: ["booking", id], queryFn: () => getBooking(id) });
  const { data: items = [] } = useQuery({
    queryKey: ["booking-items", id],
    queryFn: () => listBookingItems(id),
    enabled: !!b,
  });
  const { data: c } = useQuery({
    queryKey: ["customer", b?.customer_id],
    queryFn: () => getCustomer(b!.customer_id),
    enabled: !!b?.customer_id,
  });

  const status = useMutation({
    mutationFn: (s: BookingStatus) => setBookingStatus(id, s),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["booking", id] }); qc.invalidateQueries({ queryKey: ["bookings"] }); toast.success("Status updated"); },
  });
  const del = useMutation({
    mutationFn: () => deleteBooking(id),
    onSuccess: () => { toast.success("Deleted"); navigate({ to: "/bookings" }); },
  });

  if (isLoading || !b) return <div className="p-20 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-gold" /></div>;

  const fmtDate = (s: string) => new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  const itemsTotal = items.reduce((s, it) => s + Number(it.subtotal), 0);

  const sendWa = (template: "confirm" | "payment" | "checkin" | "checkout") => {
    if (!b.phone) { toast.error("Customer has no phone number"); return; }
    const text =
      template === "confirm" ? confirmationMessage(b) :
      template === "payment" ? paymentReminderMessage(b) :
      template === "checkin" ? checkInWelcomeMessage(b) :
      checkOutThankYouMessage(b);
    window.open(bookingWhatsAppLink(b, text), "_blank");
  };

  return (
    <>
      <Topbar title="Booking" subtitle={b.booking_reference} />
      <div className="px-4 md:px-8 py-6 md:py-8 max-w-[1100px] space-y-5">
        <Link to="/bookings" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> All bookings
        </Link>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-5">
          <div className="space-y-5">
            <section className="luxe-card rounded-xl p-6">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <h2 className="font-display text-2xl flex items-center gap-2"><BedDouble className="h-5 w-5 text-gold" />{b.guest_name}</h2>
                  <div className="text-xs font-mono text-muted-foreground mt-1">{b.booking_reference}</div>
                </div>
                <span className={cn("inline-flex items-center rounded-full border px-3 py-1 text-xs", bookingStatusStyles[b.status])}>{b.status}</span>
              </div>
              <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                {b.phone && <div className="flex items-center gap-2"><Phone className="h-3.5 w-3.5 text-muted-foreground" />{b.phone}</div>}
                {b.email && <div className="flex items-center gap-2"><Mail className="h-3.5 w-3.5 text-muted-foreground" />{b.email}</div>}
                <div className="flex items-center gap-2"><CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />{fmtDate(b.check_in)} – {fmtDate(b.check_out)} · {b.nights}N</div>
                <div className="flex items-center gap-2"><User className="h-3.5 w-3.5 text-muted-foreground" />{b.guests} Guest{b.guests === 1 ? "" : "s"} ({b.adults} adults{b.children ? `, ${b.children} children` : ""})</div>
              </div>
              {b.room_details && <div className="mt-3 text-sm"><span className="text-muted-foreground">Rooms: </span>{b.room_details}</div>}

              {items.length > 0 && (
                <div className="mt-5 pt-4 border-t border-border">
                  <h4 className="text-[10px] uppercase tracking-[0.25em] text-gold mb-3">Booking Items</h4>
                  {items.map((it, i) => (
                    <div key={it.id ?? i} className="grid grid-cols-[1fr_auto] gap-2 py-2 text-sm border-t border-border/40 first:border-0">
                      <div>
                        <div className="font-medium">{it.room_type} · {it.adults}A{it.children ? `+${it.children}C` : ""}{it.extra_bed ? ` · +${it.extra_bed} bed` : ""}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {fmtDate(it.check_in)} – {fmtDate(it.check_out)} · {it.nights}N · {it.breakfast_included ? "Breakfast incl." : "No breakfast"} · ₹{Number(it.rate).toLocaleString("en-IN")}/night
                        </div>
                      </div>
                      <div className="tabular-nums self-center">₹{Number(it.subtotal).toLocaleString("en-IN")}</div>
                    </div>
                  ))}
                  <div className="grid grid-cols-[1fr_auto] gap-2 py-2 mt-2 border-t border-border text-sm">
                    <div className="text-muted-foreground">Items Subtotal</div>
                    <div className="tabular-nums">₹{itemsTotal.toLocaleString("en-IN")}</div>
                  </div>
                </div>
              )}

              <div className="mt-4 flex items-baseline justify-between border-t border-border pt-4">
                <span className="text-sm text-muted-foreground">Grand Total</span>
                <span className="font-display text-2xl gold-text-gradient">₹{Number(b.amount).toLocaleString("en-IN")}</span>
              </div>
              {b.notes && <div className="mt-3 text-sm"><span className="text-muted-foreground">Notes: </span>{b.notes}</div>}
              {b.internal_notes && (
                <div className="mt-3 rounded-md border border-warning/30 bg-warning/5 p-3 text-xs">
                  <span className="text-warning font-medium">Internal: </span>{b.internal_notes}
                </div>
              )}
              {b.source_quote_id && (
                <div className="mt-3 text-xs">
                  <Link to="/quote/$id" params={{ id: b.source_quote_id }} className="text-gold hover:underline">View source quote →</Link>
                </div>
              )}
            </section>

            <section className="luxe-card rounded-xl p-6">
              <h3 className="font-display text-lg mb-3 flex items-center gap-2">
                <MessageCircle className="h-4 w-4 text-gold" /> Booking Communications
              </h3>
              {!b.phone && <p className="text-xs text-warning mb-3">No phone number on this booking — add one to send messages.</p>}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <CommBtn icon={Send} label="Send Confirmation" onClick={() => sendWa("confirm")} disabled={!b.phone} />
                <CommBtn icon={Wallet} label="Send Payment Reminder" onClick={() => sendWa("payment")} disabled={!b.phone} />
                <CommBtn icon={HandPlatter} label="Send Check-In Welcome" onClick={() => sendWa("checkin")} disabled={!b.phone} />
                <CommBtn icon={Heart} label="Send Check-Out Thank You" onClick={() => sendWa("checkout")} disabled={!b.phone} />
              </div>
              <p className="text-[10px] text-muted-foreground mt-3">Opens WhatsApp with the message pre-filled.</p>
            </section>
          </div>

          <div className="space-y-4">
            {c && (
              <div className="luxe-card rounded-xl p-4">
                <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Customer</div>
                <Link to="/customers/$id" params={{ id: c.id }} className="text-sm font-medium hover:text-gold">{c.guest_name}</Link>
                <div className="text-xs text-muted-foreground">{c.customer_reference}</div>
              </div>
            )}
            <div className="luxe-card rounded-xl p-4">
              <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Status</div>
              <div className="grid grid-cols-3 gap-2">
                {BOOKING_STATUSES.map((s) => (
                  <button key={s} onClick={() => status.mutate(s)} disabled={s === b.status}
                    className={cn("rounded-md border px-2 py-1.5 text-xs",
                      s === b.status ? "border-gold/50 bg-gold-soft text-gold" : "border-border bg-card text-muted-foreground hover:text-foreground hover:border-gold/30")}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
            {isAdmin && (
              <button onClick={() => { if (confirm("Delete this booking?")) del.mutate(); }}
                className="w-full inline-flex items-center justify-center gap-2 rounded-md border border-border bg-card px-4 py-2.5 text-sm text-destructive hover:bg-destructive/10">
                <Trash2 className="h-4 w-4" /> Delete Booking
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function CommBtn({ icon: Icon, label, onClick, disabled }: any) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2.5 text-sm hover:border-gold/40 disabled:opacity-50 disabled:cursor-not-allowed"
    >
      <Icon className="h-4 w-4 text-gold" />
      <span className="text-left">{label}</span>
    </button>
  );
}
