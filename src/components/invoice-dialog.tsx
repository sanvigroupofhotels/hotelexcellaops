import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Printer, Share2, X } from "lucide-react";
import { toast } from "sonner";
import type { BookingRow } from "@/lib/bookings-api";
import type { BookingItemRow } from "@/lib/booking-items-api";
import type { BookingPaymentRow } from "@/lib/booking-payments-api";
import { nodeToBlob } from "@/lib/share-quote";

const fmtDate = (s: string) =>
  new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
const fmtDateTime = (s: string) =>
  new Date(s).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" });
const inr = (n: number) => `₹${Math.round(Number(n) || 0).toLocaleString("en-IN")}`;

const HOTEL = {
  name: "HOTEL EXCELLA",
  tagline: "Boutique · Luxury · Stay",
  address: "Hotel Excella, Goa, India",
  phone: "+91 88594 44555",
  email: "stay@hotelexcella.in",
  website: "hotelexcella.in",
  gstin: "—",
};

/**
 * Invoice viewer for a booking. Renders Proforma before checkout, Final after.
 * Supports PDF download (window.print with invoice-only CSS) and image share.
 */
export function InvoiceDialog({
  booking, items = [], payments = [], onClose,
}: {
  booking: BookingRow;
  items?: BookingItemRow[];
  payments?: BookingPaymentRow[];
  onClose: () => void;
}) {
  const isFinal = booking.status === "Checked-Out" as any;
  const kind = isFinal ? "INVOICE" : "PROFORMA INVOICE";
  const docRef = useRef<HTMLDivElement>(null);

  const advance = Number(booking.advance_paid || 0);
  const total = Number(booking.amount || 0);
  const balance = Math.max(0, total - advance);
  const discount = Number(booking.discount || 0);
  const sumPayments = payments.reduce((s, p) => s + Number(p.amount || 0), 0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handlePrint = () => {
    document.body.classList.add("printing-invoice");
    const cleanup = () => {
      document.body.classList.remove("printing-invoice");
      window.removeEventListener("afterprint", cleanup);
    };
    window.addEventListener("afterprint", cleanup);
    setTimeout(() => window.print(), 50);
  };

  const handleShare = async () => {
    if (!docRef.current) return;
    try {
      const blob = await nodeToBlob(docRef.current);
      if (!blob) throw new Error("Could not render invoice");
      const filename = `${kind.replace(/ /g, "_")}_${booking.booking_reference}.png`;
      const file = new File([blob], filename, { type: "image/png" });
      const navAny = navigator as any;
      const canShareFile =
        typeof navAny.share === "function" &&
        typeof navAny.canShare === "function" &&
        navAny.canShare({ files: [file] });
      if (canShareFile) {
        try {
          await navAny.share({
            files: [file],
            title: `${HOTEL.name} · ${kind} · ${booking.booking_reference}`,
            text: `${kind} for ${booking.guest_name} · ${booking.booking_reference}`,
          });
          return;
        } catch (e: any) {
          if (e?.name === "AbortError") return;
        }
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      toast.success("Invoice image saved");
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to share");
    }
  };

  const node = (
    <div
      className="invoice-print-portal fixed inset-0 z-[100] flex items-start justify-center overflow-auto bg-black/70 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="invoice-modal-shell luxe-card rounded-2xl w-full max-w-4xl my-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Toolbar (hidden on print) */}
        <div className="invoice-print-hide flex items-center justify-between gap-2 p-4 border-b border-border">
          <div className="text-sm font-medium">{kind} · {booking.booking_reference}</div>
          <div className="flex items-center gap-2">
            <button onClick={handleShare}
              className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-xs hover:border-gold/40">
              <Share2 className="h-3.5 w-3.5 text-gold" /> Share
            </button>
            <button onClick={handlePrint}
              className="inline-flex items-center gap-2 rounded-md gold-gradient px-3 py-2 text-xs font-medium text-charcoal">
              <Printer className="h-3.5 w-3.5" /> Download PDF
            </button>
            <button onClick={onClose} className="p-2 text-muted-foreground hover:text-foreground" aria-label="Close">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Document body */}
        <div ref={docRef} className="p-6 md:p-10 bg-card text-foreground" data-invoice-print>
          {/* Header */}
          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4 pb-6 border-b border-border">
            <div className="flex items-center gap-4">
              <div className="h-14 w-14 rounded-md gold-gradient flex items-center justify-center">
                <span className="font-display text-2xl font-semibold text-charcoal">H</span>
              </div>
              <div>
                <div className="font-display text-xl">{HOTEL.name}</div>
                <div className="text-[10px] tracking-[0.3em] text-gold/80 uppercase">{HOTEL.tagline}</div>
                <div className="text-[11px] text-muted-foreground mt-1">{HOTEL.address}</div>
                <div className="text-[11px] text-muted-foreground">{HOTEL.phone} · {HOTEL.email}</div>
                <div className="text-[11px] text-muted-foreground">GSTIN: {HOTEL.gstin}</div>
              </div>
            </div>
            <div className="text-right">
              <h2 className="font-display text-3xl gold-text-gradient">{kind}</h2>
              <div className="text-xs text-muted-foreground mt-1">{booking.booking_reference}</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">Issued: {fmtDate(new Date().toISOString())}</div>
              {isFinal && <div className="text-[10px] text-muted-foreground">Checkout: {fmtDate(booking.check_out)}</div>}
            </div>
          </div>

          {/* Guest */}
          <div className="py-5 border-b border-border">
            <h4 className="text-[10px] uppercase tracking-[0.25em] text-gold mb-2">Guest Details</h4>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm">
              <div><span className="text-muted-foreground">Name: </span>{booking.guest_name}</div>
              {booking.phone && <div><span className="text-muted-foreground">Phone: </span>{booking.phone}</div>}
              {booking.email && <div><span className="text-muted-foreground">Email: </span>{booking.email}</div>}
            </div>
          </div>

          {/* Stay */}
          <div className="py-5 border-b border-border">
            <h4 className="text-[10px] uppercase tracking-[0.25em] text-gold mb-2">
              {isFinal ? "Final Stay Details" : "Stay Details"}
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm">
              <div><span className="text-muted-foreground">Check-in: </span>{fmtDate(booking.check_in)}</div>
              <div><span className="text-muted-foreground">Check-out: </span>{fmtDate(booking.check_out)}</div>
              <div><span className="text-muted-foreground">Nights: </span>{booking.nights}</div>
              <div><span className="text-muted-foreground">Guests: </span>{booking.adults} Adult{booking.adults === 1 ? "" : "s"}{booking.children > 0 ? ` + ${booking.children} Child${booking.children === 1 ? "" : "ren"}` : ""}</div>
              {booking.room_details && <div className="col-span-2"><span className="text-muted-foreground">Room: </span>{booking.room_details}</div>}
            </div>
          </div>

          {/* Room/Charges */}
          <div className="py-5 border-b border-border">
            <h4 className="text-[10px] uppercase tracking-[0.25em] text-gold mb-3">
              {isFinal ? "Final Charges" : "Charges"}
            </h4>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border">
                  <th className="text-left py-2">Description</th>
                  <th className="text-center py-2">Nights</th>
                  <th className="text-right py-2">Rate</th>
                  <th className="text-right py-2">Amount</th>
                </tr>
              </thead>
              <tbody>
                {items.length > 0 ? items.map((it) => (
                  <tr key={it.id} className="border-b border-border/50">
                    <td className="py-2">{it.room_type}{it.rooms > 1 ? ` × ${it.rooms}` : ""}{!it.breakfast_included ? "" : " (incl. breakfast)"}</td>
                    <td className="py-2 text-center tabular-nums">{it.nights}</td>
                    <td className="py-2 text-right tabular-nums">{inr(it.rate)}</td>
                    <td className="py-2 text-right tabular-nums">{inr(Number(it.subtotal))}</td>
                  </tr>
                )) : (
                  <tr className="border-b border-border/50">
                    <td className="py-2">{booking.room_details || "Room Charges"}</td>
                    <td className="py-2 text-center tabular-nums">{booking.nights}</td>
                    <td className="py-2 text-right tabular-nums">—</td>
                    <td className="py-2 text-right tabular-nums">{inr(total)}</td>
                  </tr>
                )}
                {discount > 0 && (
                  <tr className="border-b border-border/50">
                    <td className="py-2" colSpan={3}>Discount</td>
                    <td className="py-2 text-right tabular-nums">-{inr(discount)}</td>
                  </tr>
                )}
                <tr>
                  <td className="pt-3 font-medium" colSpan={3}>Total Amount</td>
                  <td className="pt-3 text-right font-display text-lg gold-text-gradient tabular-nums">{inr(total)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Payment History */}
          <div className="py-5 border-b border-border">
            <h4 className="text-[10px] uppercase tracking-[0.25em] text-gold mb-3">
              {isFinal ? "Final Payment Summary" : "Payment History"}
            </h4>
            {payments.length > 0 ? (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border">
                    <th className="text-left py-2">Date</th>
                    <th className="text-left py-2">Mode</th>
                    <th className="text-left py-2">Collected By</th>
                    <th className="text-right py-2">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((p) => (
                    <tr key={p.id} className="border-b border-border/50">
                      <td className="py-2 tabular-nums">{fmtDateTime(p.occurred_at)}</td>
                      <td className="py-2">{p.payment_mode}</td>
                      <td className="py-2">{p.collected_by}</td>
                      <td className="py-2 text-right tabular-nums">{inr(Number(p.amount))}</td>
                    </tr>
                  ))}
                  <tr>
                    <td className="pt-3 font-medium" colSpan={3}>Total Paid</td>
                    <td className="pt-3 text-right tabular-nums">{inr(sumPayments)}</td>
                  </tr>
                </tbody>
              </table>
            ) : (
              <p className="text-sm text-muted-foreground italic">No payments recorded yet.</p>
            )}
          </div>

          {/* Totals */}
          <div className="py-5">
            <div className="flex flex-col gap-1.5 text-sm max-w-xs ml-auto">
              <div className="flex justify-between"><span className="text-muted-foreground">Total Amount</span><span className="tabular-nums">{inr(total)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Amount Paid</span><span className="tabular-nums">{inr(advance)}</span></div>
              <div className="flex justify-between border-t border-border pt-2">
                <span className="font-medium">{isFinal ? "Outstanding Balance" : "Balance Due"}</span>
                <span className="font-display text-lg gold-text-gradient tabular-nums">{inr(balance)}</span>
              </div>
            </div>
          </div>

          <div className="pt-4 text-center text-[11px] text-muted-foreground border-t border-border">
            {isFinal
              ? "Thank you for staying with Hotel Excella. We hope to welcome you again."
              : "This is a Proforma Invoice. Final invoice will be issued after checkout."}
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(node, document.body);
}
