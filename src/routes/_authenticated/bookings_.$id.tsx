import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useRef, useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Topbar } from "@/components/topbar";
import { getBooking, setBookingStatus, deleteBooking } from "@/lib/bookings-api";
import { listBookingPayments, deleteBookingPayment, type BookingPaymentRow } from "@/lib/booking-payments-api";
import { listBookingPaymentActivities } from "@/lib/booking-payment-activities-api";
import { AddBookingPaymentModal } from "@/components/add-booking-payment-modal";
import { InvoiceDialog } from "@/components/invoice-dialog";
import { WhatsAppMenu, type WhatsAppTemplate } from "@/components/whatsapp-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

import { listBookingItems } from "@/lib/booking-items-api";
import { getCustomer } from "@/lib/customers-api";
import { shareQuoteImage } from "@/lib/share-quote";
import { bookingStatusStyles, type BookingStatus } from "@/lib/mock-data";
import { useRealtimeInvalidate } from "@/hooks/use-realtime";
import { useUserRole } from "@/hooks/use-role";
import {
  confirmationMessage, paymentReminderMessage, checkInWelcomeMessage,
  checkOutThankYouMessage, bookingWhatsAppLink,
} from "@/lib/booking-messages";
import { waLink } from "@/lib/quote-messages";
import {
  ArrowLeft, Loader2, Trash2, Phone, Mail, User, Copy,
  Wallet, Share2, Printer, Pencil, CalendarDays, Star, LogIn, LogOut, DoorOpen,
  FileText, History,
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
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const { data: payments = [] } = useQuery({
    queryKey: ["booking-payments", id],
    queryFn: () => listBookingPayments(id),
    enabled: !!b,
  });

  if (isLoading || !b) return <div className="p-20 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-gold" /></div>;

  const balance = Math.max(0, Number(b.amount) - Number(b.advance_paid || 0));
  const isCheckedOut = b.status === "Checked-Out";

  const sendWa = (template: WhatsAppTemplate) => {
    if (!b.phone) { toast.error("Customer has no phone number"); return; }
    if (template === "empty") { window.open(waLink(b.phone), "_blank"); return; }
    const text =
      template === "confirmation" ? confirmationMessage(b, items) :
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
            <WhatsAppMenu disabled={!b.phone} onSelect={sendWa} />
            <button onClick={() => setInvoiceOpen(true)}
              className="inline-flex items-center gap-2 rounded-md border border-gold/40 bg-gold-soft text-gold px-4 py-2.5 text-sm font-medium hover:bg-gold/20">
              <FileText className="h-4 w-4" /> {isCheckedOut ? "Generate Invoice" : "Generate Proforma Invoice"}
            </button>
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
              {/* Operational transitions are button-driven, not dropdown-driven */}
              {(() => {
                const canCheckIn = ["Pending", "Confirmed", "Advance Paid", "Full Paid"].includes(b.status as any)
                  && new Date().toISOString().slice(0, 10) >= b.check_in
                  && new Date().toISOString().slice(0, 10) < b.check_out;
                const canCheckOut = b.status === "Checked-In";
                const canCancel = !["Checked-In", "Checked-Out", "Cancelled"].includes(b.status as any);
                return (
                  <div className="space-y-2">
                    {canCheckIn && (
                      <button onClick={() => status.mutate("Checked-In" as any)}
                        className="w-full inline-flex items-center justify-center gap-2 rounded-md gold-gradient px-3 py-2.5 text-xs font-medium text-charcoal">
                        <LogIn className="h-3.5 w-3.5" /> Check-In
                      </button>
                    )}
                    {!canCheckIn && ["Pending", "Confirmed", "Advance Paid", "Full Paid"].includes(b.status as any) && (
                      <div className="text-[11px] text-muted-foreground italic">
                        Check-In available from {new Date(b.check_in).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
                      </div>
                    )}
                    {canCheckOut && (
                      <button onClick={() => status.mutate("Checked-Out" as any)}
                        className="w-full inline-flex items-center justify-center gap-2 rounded-md border border-border bg-card px-3 py-2.5 text-xs hover:border-gold/40">
                        <LogOut className="h-3.5 w-3.5" /> Check-Out
                      </button>
                    )}
                    {canCancel && (
                      <button onClick={() => { if (confirm("Cancel this booking?")) status.mutate("Cancelled" as any); }}
                        className="w-full inline-flex items-center justify-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-[11px] text-destructive hover:bg-destructive/20">
                        Cancel Booking
                      </button>
                    )}
                    <p className="text-[10px] text-muted-foreground pt-1">
                      Payment status (Pending / Advance Paid / Full Paid) is set automatically from collected payments.
                    </p>
                  </div>
                );
              })()}
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

        {isAdmin && (
          <div className="print:hidden mt-12 pt-6 border-t border-destructive/20">
            <h4 className="text-[10px] uppercase tracking-[0.25em] text-destructive/70 mb-2">Danger Zone</h4>
            <p className="text-xs text-muted-foreground mb-3">Permanently delete this booking. This cannot be undone and will affect related payment and cashbook records.</p>
            <button onClick={() => setDeleteOpen(true)}
              className="inline-flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 text-destructive px-4 py-2.5 text-sm hover:bg-destructive/20">
              <Trash2 className="h-4 w-4" /> Delete Booking
            </button>
          </div>
        )}
      </div>

      {invoiceOpen && (
        <InvoiceDialog
          booking={b}
          items={items as any}
          payments={payments}
          onClose={() => setInvoiceOpen(false)}
        />
      )}

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this booking?</AlertDialogTitle>
            <AlertDialogDescription>
              You're about to permanently delete <span className="font-medium text-foreground">{b.booking_reference}</span> for {b.guest_name}.
              This will remove all linked payments and cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => del.mutate()} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete Booking
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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



function PaymentsLedger({ bookingId, bookingAmount, advance, balance, customerId }: {
  bookingId: string; bookingAmount: number; advance: number; balance: number; customerId: string;
}) {
  const qc = useQueryClient();
  const { isAdmin } = useUserRole();
  const [addOpen, setAddOpen] = useState(false);
  const [editPayment, setEditPayment] = useState<BookingPaymentRow | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [auditOpen, setAuditOpen] = useState(false);
  const { data: payments = [] } = useQuery({
    queryKey: ["booking-payments", bookingId],
    queryFn: () => listBookingPayments(bookingId),
  });
  const { data: activities = [] } = useQuery({
    queryKey: ["booking-payment-activities", bookingId],
    queryFn: () => listBookingPaymentActivities(bookingId),
  });


  const del = useMutation({
    mutationFn: (id: string) => deleteBookingPayment(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["booking-payments", bookingId] });
      qc.invalidateQueries({ queryKey: ["booking-payment-activities", bookingId] });
      qc.invalidateQueries({ queryKey: ["booking", bookingId] });
      qc.invalidateQueries({ queryKey: ["cash"] });
      toast.success("Payment removed");
      setDeleteId(null);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const pendingDelete = payments.find((p) => p.id === deleteId);

  return (
    <div className="luxe-card rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <h4 className="font-display text-lg flex items-center gap-2"><Wallet className="h-4 w-4 text-gold" /> Payments</h4>
        <button
          onClick={() => setAddOpen(true)}
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
              <div className="flex items-center gap-0.5 shrink-0">
                <button onClick={() => setEditPayment(p)}
                  className="p-1 text-muted-foreground hover:text-gold" title="Edit">
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                {isAdmin && (
                  <button onClick={() => setDeleteId(p.id)}
                    className="p-1 text-muted-foreground hover:text-destructive" title="Delete (admin only)">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {addOpen && (
        <AddBookingPaymentModal
          bookingId={bookingId} customerId={customerId} maxAmount={balance}
          onClose={() => setAddOpen(false)}
        />
      )}
      {editPayment && (
        <AddBookingPaymentModal
          bookingId={bookingId} customerId={customerId}
          maxAmount={balance + Number(editPayment.amount)}
          payment={editPayment}
          onClose={() => setEditPayment(null)}
        />
      )}

      <AlertDialog open={!!deleteId} onOpenChange={(o) => { if (!o) setDeleteId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this payment?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete && (
                <>
                  You're about to delete <span className="font-medium text-foreground">₹{Number(pendingDelete.amount).toLocaleString("en-IN")} · {pendingDelete.payment_mode}</span> collected by {pendingDelete.collected_by}.
                  <br /><br />
                  This will recalculate <span className="text-foreground">Advance Paid</span> and <span className="text-foreground">Balance Due</span>, and the corresponding CashBook entry (if any) and Payment Reports will be affected. This action cannot be undone.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteId && del.mutate(deleteId)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete Payment
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

