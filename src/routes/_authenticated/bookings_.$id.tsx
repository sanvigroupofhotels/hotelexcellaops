import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useRef, useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Topbar } from "@/components/topbar";
import { getBooking, setBookingStatus, deleteBooking } from "@/lib/bookings-api";
import { listBookingPayments, createBookingPayment, deleteBookingPayment, PAYMENT_MODES } from "@/lib/booking-payments-api";
import { listStaff } from "@/lib/cash-api";
import { listBookingItems } from "@/lib/booking-items-api";
import { getCustomer } from "@/lib/customers-api";
import { shareQuoteImage } from "@/lib/share-quote";
import { BOOKING_STATUSES, bookingStatusStyles, earlyCheckInLabel, lateCheckOutLabel, type BookingStatus } from "@/lib/mock-data";
import { useRealtimeInvalidate } from "@/hooks/use-realtime";
import { useUserRole } from "@/hooks/use-role";
import {
  confirmationMessage, paymentReminderMessage, checkInWelcomeMessage,
  checkOutThankYouMessage, bookingWhatsAppLink,
} from "@/lib/booking-messages";
import {
  ArrowLeft, Loader2, Trash2, BedDouble, Phone, Mail, User, Copy,
  Send, Wallet, HandPlatter, Heart, Share2, Printer, Pencil, CalendarDays, Star, LogIn, LogOut, DoorOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { StayItemsList } from "@/components/shared/stay-items-list";
import { listRooms } from "@/lib/rooms-api";
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
    queryKey: ["booking-items", id], queryFn: () => listBookingItems(id), enabled: !!b,
  });
  const { data: c } = useQuery({
    queryKey: ["customer", b?.customer_id], queryFn: () => getCustomer(b!.customer_id), enabled: !!b?.customer_id,
  });
  const { data: rooms = [] } = useQuery({ queryKey: ["rooms", "active"], queryFn: () => listRooms(true) });

  const status = useMutation({
    mutationFn: (s: BookingStatus) => setBookingStatus(id, s),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["booking", id] }); qc.invalidateQueries({ queryKey: ["bookings"] }); toast.success("Status updated"); },
  });
  const del = useMutation({
    mutationFn: () => deleteBooking(id),
    onSuccess: () => { toast.success("Deleted"); navigate({ to: "/bookings" }); },
  });

  const cardRef = useRef<HTMLDivElement>(null);

  if (isLoading || !b) return <div className="p-20 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-gold" /></div>;

  const balance = Math.max(0, Number(b.amount) - Number(b.advance_paid || 0));

  const sendWa = (template: "confirm" | "payment" | "checkin" | "checkout") => {
    if (!b.phone) { toast.error("Customer has no phone number"); return; }
    const text =
      template === "confirm" ? confirmationMessage(b, items) :
      template === "payment" ? paymentReminderMessage(b, balance > 0 ? balance : undefined) :
      template === "checkin" ? checkInWelcomeMessage(b) :
      checkOutThankYouMessage(b);
    window.open(bookingWhatsAppLink(b, text), "_blank");
  };

  return (
    <>
      <Topbar title="Booking" subtitle={b.booking_reference} />
      <div className="px-4 md:px-8 py-6 md:py-8 max-w-[1400px] space-y-6 print:p-0">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 print:hidden">
          <Link to="/bookings" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> All bookings
          </Link>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => cardRef.current && shareQuoteImage(cardRef.current, b as any)}
              className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-4 py-2.5 text-sm hover:border-gold/40">
              <Share2 className="h-4 w-4 text-gold" /> Share Image
            </button>
            <button onClick={() => window.print()}
              className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-4 py-2.5 text-sm hover:border-gold/40">
              <Printer className="h-4 w-4 text-gold" /> PDF
            </button>
            <button
              onClick={() => {
                navigator.clipboard.writeText(confirmationMessage(b, items)).then(
                  () => toast.success("Booking confirmation copied"),
                  () => toast.error("Copy failed"),
                );
              }}
              className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-4 py-2.5 text-sm hover:border-gold/40">
              <Copy className="h-4 w-4 text-gold" /> Copy
            </button>
            <Link to="/bookings/$id/edit" params={{ id }}
              className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-4 py-2.5 text-sm hover:border-gold/40">
              <Pencil className="h-4 w-4 text-gold" /> Edit
            </Link>
            <CommBtn icon={Send} label="Send Confirmation" onClick={() => sendWa("confirm")} disabled={!b.phone} />
            <CommBtn icon={Wallet} label="Send Payment Reminder" onClick={() => sendWa("payment")} disabled={!b.phone} />
            <CommBtn icon={HandPlatter} label="Send Check-In Welcome" onClick={() => sendWa("checkin")} disabled={!b.phone} />
            <CommBtn icon={Heart} label="Send Check-Out Thank You" onClick={() => sendWa("checkout")} disabled={!b.phone} />
            {isAdmin && (
              <button onClick={() => { if (confirm("Delete this booking?")) del.mutate(); }}
                className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-4 py-2.5 text-sm text-destructive hover:bg-destructive/10">
                <Trash2 className="h-4 w-4" /> Delete
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6 print:block">
          <div ref={cardRef}>
            <BookingCard b={b} items={items} balance={balance} />
          </div>

          <div className="space-y-4 print:hidden">
            {c && (
              <div className="luxe-card rounded-xl p-4">
                <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Customer</div>
                <Link to="/customers/$id" params={{ id: c.id }} className="text-sm font-medium hover:text-gold">{c.guest_name} →</Link>
                <div className="text-xs text-muted-foreground">{c.customer_reference}</div>
                {c.phone && <div className="text-[11px] text-muted-foreground mt-1">{c.phone}</div>}
              </div>
            )}

            <div className="luxe-card rounded-xl p-5">
              <h4 className="font-display text-lg mb-3">Status</h4>
              <div className="mb-3">
                <span className={cn("inline-flex items-center rounded-full border px-3 py-1 text-xs", bookingStatusStyles[b.status])}>{b.status}</span>
              </div>
              {/* Check-In / Check-Out quick actions */}
              {(() => {
                const canCheckIn = ["Pending", "Confirmed", "Advance Paid", "Full Paid"].includes(b.status as any)
                  && new Date().toISOString().slice(0, 10) >= b.check_in;
                const canCheckOut = b.status === "Checked-In";
                if (!canCheckIn && !canCheckOut) return null;
                return (
                  <div className="flex gap-2 mb-3">
                    {canCheckIn && (
                      <button onClick={() => status.mutate("Checked-In" as any)}
                        className="flex-1 inline-flex items-center justify-center gap-2 rounded-md gold-gradient px-3 py-2 text-xs font-medium text-charcoal">
                        <LogIn className="h-3.5 w-3.5" /> Check-In
                      </button>
                    )}
                    {canCheckOut && (
                      <button onClick={() => status.mutate("Checked-Out" as any)}
                        className="flex-1 inline-flex items-center justify-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-xs">
                        <LogOut className="h-3.5 w-3.5" /> Check-Out
                      </button>
                    )}
                  </div>
                );
              })()}
              <div className="grid grid-cols-2 gap-2">
                {BOOKING_STATUSES.map((s) => (
                  <button key={s} onClick={() => status.mutate(s)} disabled={s === b.status}
                    className={cn("rounded-md border px-2 py-1.5 text-xs transition",
                      s === b.status ? "border-gold/50 bg-gold-soft text-gold" : "border-border bg-card text-muted-foreground hover:text-foreground hover:border-gold/30")}>
                    {s}
                  </button>
                ))}
              </div>
            </div>

            {/* Assigned room */}
            <div className="luxe-card rounded-xl p-5">
              <h4 className="font-display text-lg mb-2 flex items-center gap-2"><DoorOpen className="h-4 w-4 text-gold" /> Room Assignment</h4>
              {(() => {
                const room = rooms.find((r: any) => r.id === (b as any).room_id);
                return room ? (
                  <div className="text-sm">Room <span className="font-medium">{room.room_number}</span> · {room.room_type} · Floor {room.floor}</div>
                ) : (
                  <div className="text-xs text-muted-foreground italic">No room assigned</div>
                );
              })()}
              <Link to="/bookings/$id/edit" params={{ id }} className="text-[11px] text-gold hover:underline mt-2 inline-block">Assign / Change →</Link>
            </div>

            <PaymentsLedger bookingId={id} bookingAmount={Number(b.amount)} advance={Number(b.advance_paid || 0)} balance={balance} customerId={b.customer_id} />


            {b.source_quote_id && (
              <div className="luxe-card rounded-xl p-4 text-xs">
                <Link to="/quote/$id" params={{ id: b.source_quote_id }} className="text-gold hover:underline">View source quote →</Link>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function BookingCard({ b, items = [], balance }: { b: any; items?: any[]; balance: number }) {
  const multi = items.length > 1;
  const fmtDate = (s: string) => new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
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
          <h2 className="font-display text-4xl gold-text-gradient">BOOKING</h2>
          <div className="text-xs text-muted-foreground mt-1">{b.booking_reference}</div>
          <div className="text-[10px] text-muted-foreground mt-0.5">Created: {new Date(b.created_at).toLocaleDateString("en-IN")}</div>
        </div>
      </div>

      <div className="relative py-6 border-b border-border">
        <h4 className="text-[10px] uppercase tracking-[0.25em] text-gold mb-3">Guest Details</h4>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
          <div className="flex items-center gap-2"><User className="h-3.5 w-3.5 text-muted-foreground" />{b.guest_name}</div>
          {b.phone && <div className="flex items-center gap-2"><Phone className="h-3.5 w-3.5 text-muted-foreground" />{b.phone}</div>}
          {b.email && <div className="flex items-center gap-2"><Mail className="h-3.5 w-3.5 text-muted-foreground" />{b.email}</div>}
        </div>
      </div>

      {multi ? (
        <div className="relative py-6 border-b border-border space-y-5">
          <StayItemsList items={items} />
        </div>
      ) : items.length === 1 ? (
        <div className="relative py-6 border-b border-border">
          <h4 className="text-[10px] uppercase tracking-[0.25em] text-gold mb-3">Stay Details</h4>
          <ul className="text-sm space-y-1">
            <li>• <span className="text-muted-foreground">Room Type:</span> {items[0].room_type}{items[0].rooms > 1 ? ` × ${items[0].rooms}` : ""}</li>
            <li>• <span className="text-muted-foreground">Dates:</span> {fmtDate(items[0].check_in)} – {fmtDate(items[0].check_out)} ({items[0].nights}N)</li>
            <li>• <span className="text-muted-foreground">Guests:</span> {b.adults} Adult{b.adults === 1 ? "" : "s"}{b.children > 0 ? ` + ${b.children} Child${b.children === 1 ? "" : "ren"}` : ""}</li>
            <li>• <span className="text-muted-foreground">Breakfast:</span> {items[0].breakfast_included ? "Included" : "Not Included"}</li>
          </ul>
        </div>
      ) : (
        <div className="relative py-6 border-b border-border">
          <h4 className="text-[10px] uppercase tracking-[0.25em] text-gold mb-3">Stay Details</h4>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div><div className="flex items-center gap-1.5"><CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />{fmtDate(b.check_in)}</div><div className="text-[10px] text-muted-foreground mt-0.5">Check-in · 1:00 PM</div></div>
            <div><div className="flex items-center gap-1.5"><CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />{fmtDate(b.check_out)}</div><div className="text-[10px] text-muted-foreground mt-0.5">Check-out · 11:00 AM</div></div>
            <div className="col-span-2 text-xs text-muted-foreground">{b.guests} Guest{b.guests === 1 ? "" : "s"} · {b.nights} Night{b.nights === 1 ? "" : "s"}{b.room_details ? ` · ${b.room_details}` : ""}</div>
          </div>
        </div>
      )}

      <div className="relative py-6 border-b border-border space-y-2">
        <div className="flex items-baseline justify-between">
          <span className="font-display text-2xl">Total Amount</span>
          <span className="font-display text-3xl gold-text-gradient">₹{Number(b.amount).toLocaleString("en-IN")}</span>
        </div>
        {Number(b.advance_paid || 0) > 0 && (
          <>
            <div className="flex items-baseline justify-between text-sm">
              <span className="text-muted-foreground">Advance Paid</span>
              <span className="tabular-nums">−₹{Number(b.advance_paid).toLocaleString("en-IN")}</span>
            </div>
            <div className="flex items-baseline justify-between pt-1">
              <span className="text-sm font-medium">Balance Payable</span>
              <span className="font-display text-xl text-gold">₹{balance.toLocaleString("en-IN")}</span>
            </div>
          </>
        )}
      </div>

      {b.notes && <div className="relative py-4 border-b border-border text-sm"><span className="text-muted-foreground">Notes: </span>{b.notes}</div>}
      {b.internal_notes && (
        <div className="relative py-4 border-b border-border print:hidden">
          <div className="rounded-md border border-warning/30 bg-warning/5 p-3 text-xs">
            <span className="text-warning font-medium">Internal: </span>{b.internal_notes}
          </div>
        </div>
      )}

      <div className="relative pt-6 text-center">
        <p className="font-display italic text-lg text-gold/90">Thank you for booking with Hotel Excella</p>
        <div className="flex justify-center gap-1 mt-3">
          {Array.from({ length: 5 }).map((_, i) => <Star key={i} className="h-4 w-4 fill-gold text-gold" />)}
        </div>
      </div>
    </div>
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

function PaymentsLedger({ bookingId, bookingAmount, advance, balance, customerId }: {
  bookingId: string; bookingAmount: number; advance: number; balance: number; customerId: string;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const { data: payments = [] } = useQuery({
    queryKey: ["booking-payments", bookingId],
    queryFn: () => listBookingPayments(bookingId),
  });
  const { data: staff = [] } = useQuery({ queryKey: ["staff", "active"], queryFn: () => listStaff(true) });

  const del = useMutation({
    mutationFn: (id: string) => deleteBookingPayment(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["booking-payments", bookingId] });
      qc.invalidateQueries({ queryKey: ["booking", bookingId] });
      toast.success("Payment removed");
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="luxe-card rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <h4 className="font-display text-lg flex items-center gap-2"><Wallet className="h-4 w-4 text-gold" /> Payments</h4>
        <button
          onClick={() => setOpen(true)}
          disabled={balance <= 0}
          className="rounded-md gold-gradient px-3 py-1.5 text-xs font-medium text-charcoal disabled:opacity-50 disabled:cursor-not-allowed">
          + Add Payment
        </button>
      </div>
      <div className="space-y-1 text-sm">
        <div className="flex justify-between"><span className="text-muted-foreground">Total Booking Amount</span><span className="tabular-nums">₹{bookingAmount.toLocaleString("en-IN")}</span></div>
        <div className="flex justify-between"><span className="text-muted-foreground">Total Advance Paid</span><span className="tabular-nums">₹{advance.toLocaleString("en-IN")}</span></div>
        <div className="flex justify-between border-t border-border pt-2"><span className="font-medium">Balance Due</span><span className="font-display text-lg gold-text-gradient">₹{balance.toLocaleString("en-IN")}</span></div>
      </div>

      {payments.length > 0 && (
        <div className="mt-4 space-y-2">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Payment History</div>
          {payments.map((p) => (
            <div key={p.id} className="text-xs rounded-md border border-border bg-secondary/40 px-3 py-2 flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-medium tabular-nums">₹{Number(p.amount).toLocaleString("en-IN")} <span className="text-muted-foreground">· {p.payment_mode}</span></div>
                <div className="text-[10px] text-muted-foreground">Collected By: {p.collected_by} · {new Date(p.occurred_at).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" })}</div>
                {p.notes && <div className="text-[10px] text-muted-foreground mt-0.5 truncate">{p.notes}</div>}
              </div>
              <button onClick={() => { if (confirm("Remove this payment?")) del.mutate(p.id); }}
                className="p-1 text-muted-foreground hover:text-destructive shrink-0" title="Remove">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {open && (
        <AddPaymentModal
          bookingId={bookingId} customerId={customerId} maxAmount={balance}
          staff={staff as any[]}
          onClose={() => setOpen(false)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["booking-payments", bookingId] });
            qc.invalidateQueries({ queryKey: ["booking", bookingId] });
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}

function AddPaymentModal({ bookingId, customerId, maxAmount, staff, onClose, onSaved }: {
  bookingId: string; customerId: string; maxAmount: number; staff: any[];
  onClose: () => void; onSaved: () => void;
}) {
  const [amount, setAmount] = useState<number>(maxAmount);
  const [mode, setMode] = useState<string>(PAYMENT_MODES[0]);
  const [collectedBy, setCollectedBy] = useState<string>("");
  const [occurredAt, setOccurredAt] = useState<string>(() => {
    const d = new Date();
    const tz = d.getTimezoneOffset();
    const local = new Date(d.getTime() - tz * 60000);
    return local.toISOString().slice(0, 16);
  });
  const [notes, setNotes] = useState("");
  const save = useMutation({
    mutationFn: () => createBookingPayment({
      booking_id: bookingId,
      customer_id: customerId,
      amount,
      payment_mode: mode,
      collected_by: collectedBy,
      occurred_at: new Date(occurredAt).toISOString(),
      notes: notes || null,
    }),
    onSuccess: () => { toast.success("Payment added"); onSaved(); },
    onError: (e: any) => toast.error(e.message),
  });
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="luxe-card rounded-xl w-full max-w-md p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-display text-xl">Add Payment</h3>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <label className="col-span-1 block">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Amount *</span>
            <input type="number" min={0.01} step="0.01" value={amount} onChange={(e) => setAmount(Number(e.target.value))}
              className="w-full bg-input/60 border border-border rounded-md px-3 py-2 text-sm" />
          </label>
          <label className="col-span-1 block">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Payment Mode *</span>
            <select value={mode} onChange={(e) => setMode(e.target.value)}
              className="w-full bg-input/60 border border-border rounded-md px-3 py-2 text-sm">
              {PAYMENT_MODES.map((m) => <option key={m}>{m}</option>)}
            </select>
          </label>
          <label className="col-span-2 block">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Collected By *</span>
            {staff.length > 0 ? (
              <select value={collectedBy} onChange={(e) => setCollectedBy(e.target.value)}
                className="w-full bg-input/60 border border-border rounded-md px-3 py-2 text-sm">
                <option value="">Select…</option>
                {staff.map((s: any) => <option key={s.id} value={s.name}>{s.name}</option>)}
              </select>
            ) : (
              <input value={collectedBy} onChange={(e) => setCollectedBy(e.target.value)} placeholder="Staff name"
                className="w-full bg-input/60 border border-border rounded-md px-3 py-2 text-sm" />
            )}
          </label>
          <label className="col-span-2 block">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Date &amp; Time</span>
            <input type="datetime-local" value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)}
              className="w-full bg-input/60 border border-border rounded-md px-3 py-2 text-sm" />
          </label>
          <label className="col-span-2 block">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Notes</span>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
              className="w-full bg-input/60 border border-border rounded-md px-3 py-2 text-sm" />
          </label>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="rounded-md border border-border bg-card px-3 py-2 text-xs">Cancel</button>
          <button onClick={() => save.mutate()} disabled={save.isPending || !collectedBy || !(amount > 0)}
            className="rounded-md gold-gradient px-4 py-2 text-xs font-medium text-charcoal disabled:opacity-50">
            {save.isPending ? "Saving…" : "Save Payment"}
          </button>
        </div>
      </div>
    </div>
  );
}
