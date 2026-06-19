import { useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { Printer, Share2, X } from "lucide-react";
import { toast } from "sonner";
import type { BookingRow } from "@/lib/bookings-api";
import type { BookingItemRow } from "@/lib/booking-items-api";
import { rowToLineItem } from "@/lib/booking-items-api";
import type { BookingPaymentRow } from "@/lib/booking-payments-api";
import type { BookingChargeRow } from "@/lib/booking-charges-api";
import { chargesTotal as sumCharges } from "@/lib/booking-charges-api";
import { nodeToBlob } from "@/lib/share-quote";
import { computePricing } from "@/lib/pricing";
import { useOpsTimeLabels } from "@/lib/check-times";
import { getBrandingSettings } from "@/lib/app-settings-api";

const fmtDate = (s: string) =>
  new Date(s + (s.length === 10 ? "T00:00:00" : "")).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
const fmtDateTime = (s: string) =>
  new Date(s).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
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

/* Brand palette scoped to the invoice document (print-safe, theme-independent). */
const INV_VARS: React.CSSProperties = {
  // deep teal primary, refined ink, parchment surfaces, gold accent
  ["--inv-ink" as any]: "#0f1a24",
  ["--inv-muted" as any]: "#5b6b7a",
  ["--inv-line" as any]: "#e5e7eb",
  ["--inv-soft" as any]: "#f6f7f9",
  ["--inv-primary" as any]: "#0e3b46",
  ["--inv-primary-2" as any]: "#15545e",
  ["--inv-gold" as any]: "#c9a24a",
  ["--inv-gold-2" as any]: "#e1c98c",
  ["--inv-bg" as any]: "#ffffff",
};

export function InvoiceDialog({
  booking, items = [], payments = [], charges = [], onClose,
}: {
  booking: BookingRow;
  items?: BookingItemRow[];
  payments?: BookingPaymentRow[];
  charges?: BookingChargeRow[];
  onClose: () => void;
}) {
  const isFinal = booking.status === ("Checked-Out" as any);
  const kind = isFinal ? "INVOICE" : "PROFORMA INVOICE";
  const docRef = useRef<HTMLDivElement>(null);
  const checkTimes = useOpsTimeLabels();
  const { data: branding } = useQuery({ queryKey: ["branding-settings"], queryFn: getBrandingSettings });

  const chargesTotal = sumCharges(charges);
  const advance = Number(booking.advance_paid || 0);
  const bookingAmount = Number(booking.amount || 0);
  const total = bookingAmount + chargesTotal;
  const balance = Math.max(0, total - advance);
  const discount = Number(booking.discount || 0);
  const taxRate = Number((booking as any).tax_rate || 0);

  const pricing = useMemo(() => {
    if (!items.length) return null;
    try {
      return computePricing(
        items.map(rowToLineItem),
        discount,
        taxRate,
        {
          totalOverride: (booking as any).total_override ?? null,
          taxesIncluded: !!(booking as any).taxes_included,
        },
      );
    } catch { return null; }
  }, [items, discount, taxRate, booking]);

  const itemsTotal = pricing?.itemsTotal ?? Math.max(0, bookingAmount + discount - Number((booking as any).taxes || 0));
  const taxable = pricing?.subtotal ?? Math.max(0, bookingAmount - Number((booking as any).taxes || 0));
  const taxes = pricing?.taxes ?? Number((booking as any).taxes || 0);
  const mainStay = pricing?.mainStayCharges ?? itemsTotal;
  const extraLines = pricing?.additionalLineItems ?? [];
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

  const guestsLabel = `${booking.adults} Adult${booking.adults === 1 ? "" : "s"}${
    booking.children > 0 ? ` + ${booking.children} Child${booking.children === 1 ? "" : "ren"}` : ""
  }`;

  const node = (
    <div
      className="invoice-print-portal fixed inset-0 z-[100] flex items-start justify-center overflow-auto bg-black/70 backdrop-blur-sm p-2 sm:p-4"
      onClick={onClose}
    >
      <div
        className="invoice-modal-shell rounded-2xl w-full max-w-3xl my-2 sm:my-6 shadow-2xl bg-white"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Toolbar (hidden on print) */}
        <div className="invoice-print-hide flex items-center justify-between gap-2 p-3 sm:p-4 border-b border-[var(--inv-line)] rounded-t-2xl bg-white" style={INV_VARS}>
          <div className="text-xs sm:text-sm font-medium text-[var(--inv-ink)] truncate">{kind} · {booking.booking_reference}</div>
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <button onClick={handleShare}
              className="inline-flex items-center gap-1.5 rounded-md border border-[var(--inv-line)] px-2.5 py-2 text-xs text-[var(--inv-ink)] hover:bg-[var(--inv-soft)]">
              <Share2 className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Share</span>
            </button>
            <button onClick={handlePrint}
              className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-2 text-xs font-semibold text-white"
              style={{ background: "linear-gradient(135deg, var(--inv-primary), var(--inv-primary-2))" }}>
              <Printer className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Download PDF</span>
            </button>
            <button onClick={onClose} className="p-2 text-[var(--inv-muted)] hover:text-[var(--inv-ink)]" aria-label="Close" style={INV_VARS}>
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Document body — A4 friendly, single column on mobile */}
        <div
          ref={docRef}
          data-invoice-print
          className="invoice-doc bg-white text-[var(--inv-ink)] rounded-b-2xl"
          style={{
            ...INV_VARS,
            fontFamily: "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif",
          }}
        >
          {/* ── HEADER BAR (B style) ── */}
          <div
            className="px-5 sm:px-10 py-6 sm:py-7 text-white rounded-t-2xl"
            style={{ background: "linear-gradient(135deg, var(--inv-primary) 0%, var(--inv-primary-2) 100%)" }}
          >
            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 items-start">
              <div className="flex items-center gap-3 min-w-0">
                <div
                  className="h-12 w-12 sm:h-14 sm:w-14 shrink-0 rounded-lg grid place-items-center"
                  style={{ background: "linear-gradient(135deg, var(--inv-gold) 0%, var(--inv-gold-2) 100%)" }}
                >
                  <span style={{ fontFamily: "'Fraunces', Georgia, serif" }} className="text-2xl sm:text-3xl font-bold text-[var(--inv-primary)]">H</span>
                </div>
                <div className="min-w-0">
                  <div style={{ fontFamily: "'Fraunces', Georgia, serif" }} className="text-lg sm:text-2xl font-semibold leading-tight truncate">
                    {HOTEL.name}
                  </div>
                  <div className="text-[10px] sm:text-[11px] tracking-[0.28em] uppercase text-white/70">{HOTEL.tagline}</div>
                </div>
              </div>
              <div className="text-right shrink-0">
                <div
                  className="inline-block px-2.5 py-1 rounded text-[10px] sm:text-[11px] font-semibold tracking-[0.22em]"
                  style={{ background: "var(--inv-gold)", color: "var(--inv-primary)" }}
                >
                  {kind}
                </div>
                <div className="text-[11px] sm:text-xs text-white/85 mt-1.5 font-medium">{booking.booking_reference}</div>
                <div className="text-[10px] text-white/65 mt-0.5">Issued {fmtDate(new Date().toISOString())}</div>
              </div>
            </div>
          </div>

          <div className="px-5 sm:px-10 py-5 sm:py-7 space-y-5 sm:space-y-6">

            {/* ── GRAND TOTAL HERO BAND (C-style, prominent) ── */}
            <div
              className="rounded-xl p-4 sm:p-5 grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 items-center"
              style={{ background: "var(--inv-soft)", border: "1px solid var(--inv-line)" }}
            >
              <div className="sm:col-span-2 grid grid-cols-2 gap-3 sm:gap-4">
                <div>
                  <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--inv-muted)]">Grand Total</div>
                  <div style={{ fontFamily: "'Fraunces', Georgia, serif" }} className="text-2xl sm:text-3xl font-semibold text-[var(--inv-ink)] tabular-nums leading-tight mt-0.5">
                    {inr(total)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--inv-muted)]">Amount Paid</div>
                  <div className="text-xl sm:text-2xl font-semibold tabular-nums leading-tight mt-0.5 text-[var(--inv-primary)]">{inr(advance)}</div>
                </div>
              </div>
              <div
                className="rounded-lg p-3 sm:p-4 text-center sm:text-right"
                style={{
                  background: balance > 0
                    ? "linear-gradient(135deg, var(--inv-gold) 0%, var(--inv-gold-2) 100%)"
                    : "linear-gradient(135deg, #0e7c5e, #15966e)",
                  color: balance > 0 ? "var(--inv-primary)" : "#fff",
                }}
              >
                <div className="text-[10px] uppercase tracking-[0.18em] opacity-80">
                  {isFinal ? "Outstanding" : "Balance Due"}
                </div>
                <div style={{ fontFamily: "'Fraunces', Georgia, serif" }} className="text-2xl sm:text-3xl font-bold tabular-nums leading-tight mt-0.5">
                  {inr(balance)}
                </div>
                {balance === 0 && <div className="text-[10px] mt-0.5 opacity-90">Fully Settled</div>}
              </div>
            </div>

            {/* ── FROM / TO ── */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
              <div className="rounded-lg p-3 sm:p-4" style={{ border: "1px solid var(--inv-line)" }}>
                <div className="text-[10px] uppercase tracking-[0.2em] text-[var(--inv-muted)] mb-1.5">From</div>
                <div className="font-semibold text-[var(--inv-ink)] text-sm">{HOTEL.name}</div>
                <div className="text-[11px] sm:text-xs text-[var(--inv-muted)] leading-relaxed mt-0.5">
                  {HOTEL.address}<br />
                  {HOTEL.phone} · {HOTEL.email}<br />
                  GSTIN: {HOTEL.gstin}
                </div>
              </div>
              <div className="rounded-lg p-3 sm:p-4" style={{ border: "1px solid var(--inv-line)", background: "var(--inv-soft)" }}>
                <div className="text-[10px] uppercase tracking-[0.2em] text-[var(--inv-muted)] mb-1.5">Billed To</div>
                <div className="font-semibold text-[var(--inv-ink)] text-sm">{booking.guest_name}</div>
                <div className="text-[11px] sm:text-xs text-[var(--inv-muted)] leading-relaxed mt-0.5">
                  {booking.phone && <>{booking.phone}<br /></>}
                  {booking.email && <>{booking.email}<br /></>}
                </div>
              </div>
            </div>

            {/* ── STAY (check-in / out highlighted, C-style) ── */}
            <div>
              <div className="text-[10px] uppercase tracking-[0.22em] text-[var(--inv-muted)] mb-2 font-semibold">Stay Details</div>
              <div className="grid grid-cols-2 gap-2 sm:gap-3">
                <div className="rounded-lg p-3" style={{ border: "1px solid var(--inv-line)" }}>
                  <div className="text-[10px] uppercase tracking-wider text-[var(--inv-muted)]">Check-In</div>
                  <div className="font-semibold text-[var(--inv-ink)] text-sm sm:text-base mt-0.5">{fmtDate(booking.check_in)}</div>
                  <div className="text-[11px] text-[var(--inv-primary)] font-medium">{checkTimes.checkIn}</div>
                </div>
                <div className="rounded-lg p-3" style={{ border: "1px solid var(--inv-line)" }}>
                  <div className="text-[10px] uppercase tracking-wider text-[var(--inv-muted)]">Check-Out</div>
                  <div className="font-semibold text-[var(--inv-ink)] text-sm sm:text-base mt-0.5">{fmtDate(booking.check_out)}</div>
                  <div className="text-[11px] text-[var(--inv-primary)] font-medium">{checkTimes.checkOut}</div>
                </div>
                <div className="rounded-lg p-3" style={{ border: "1px solid var(--inv-line)" }}>
                  <div className="text-[10px] uppercase tracking-wider text-[var(--inv-muted)]">Nights</div>
                  <div className="font-semibold text-[var(--inv-ink)] text-sm sm:text-base mt-0.5">{booking.nights}</div>
                </div>
                <div className="rounded-lg p-3" style={{ border: "1px solid var(--inv-line)" }}>
                  <div className="text-[10px] uppercase tracking-wider text-[var(--inv-muted)]">Guests</div>
                  <div className="font-semibold text-[var(--inv-ink)] text-sm sm:text-base mt-0.5">{guestsLabel}</div>
                </div>
                {booking.room_details && (
                  <div className="col-span-2 rounded-lg p-3" style={{ border: "1px solid var(--inv-line)" }}>
                    <div className="text-[10px] uppercase tracking-wider text-[var(--inv-muted)]">Room</div>
                    <div className="font-semibold text-[var(--inv-ink)] text-sm mt-0.5">{booking.room_details}</div>
                  </div>
                )}
              </div>
            </div>

            {/* ── CHARGES (responsive: table on sm+, list on mobile) ── */}
            <div>
              <div className="text-[10px] uppercase tracking-[0.22em] text-[var(--inv-muted)] mb-2 font-semibold">
                {isFinal ? "Final Charges" : "Charges"}
              </div>
              <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--inv-line)" }}>
                {/* Mobile list */}
                <ul className="sm:hidden divide-y" style={{ borderColor: "var(--inv-line)" }}>
                  <li className="flex justify-between gap-3 p-3 text-sm">
                    <span className="font-medium text-[var(--inv-ink)]">Main Stay Charges</span>
                    <span className="tabular-nums">{inr(mainStay)}</span>
                  </li>
                  {extraLines.map((ex, i) => (
                    <li key={`mex-${i}`} className="flex justify-between gap-3 p-3 text-sm">
                      <span className="text-[var(--inv-muted)]">{ex.label}</span>
                      <span className="tabular-nums">{inr(ex.value)}</span>
                    </li>
                  ))}
                  {charges.map((c, i) => (
                    <li key={`mch-${i}`} className="flex justify-between gap-3 p-3 text-sm">
                      <span className="text-[var(--inv-muted)] min-w-0 truncate">
                        {c.category}{c.category === "Other" && c.other_description ? ` · ${c.other_description}` : ""}{Number(c.quantity) !== 1 ? ` × ${Number(c.quantity)}` : ""}
                      </span>
                      <span className="tabular-nums shrink-0">{inr(Number(c.amount))}</span>
                    </li>
                  ))}
                </ul>
                {/* Desktop / A4 table */}
                <table className="hidden sm:table w-full text-sm">
                  <thead>
                    <tr style={{ background: "var(--inv-soft)" }}>
                      <th className="text-left p-3 text-[10px] uppercase tracking-wider text-[var(--inv-muted)] font-semibold">Particulars</th>
                      <th className="text-right p-3 text-[10px] uppercase tracking-wider text-[var(--inv-muted)] font-semibold">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr style={{ borderTop: "1px solid var(--inv-line)" }}>
                      <td className="p-3 font-medium">Main Stay Charges</td>
                      <td className="p-3 text-right tabular-nums">{inr(mainStay)}</td>
                    </tr>
                    {extraLines.length > 0 && extraLines.map((ex, i) => (
                      <tr key={`ex-${i}`} style={{ borderTop: "1px solid var(--inv-line)" }}>
                        <td className="p-3 pl-6 text-[var(--inv-muted)]">{ex.label}</td>
                        <td className="p-3 text-right tabular-nums">{inr(ex.value)}</td>
                      </tr>
                    ))}
                    {chargesTotal > 0 && (
                      <tr style={{ borderTop: "1px solid var(--inv-line)", background: "var(--inv-soft)" }}>
                        <td className="px-3 py-1.5 text-[11px] uppercase tracking-wider text-[var(--inv-muted)] font-semibold" colSpan={2}>
                          In-House Charges <span className="normal-case font-normal">(tax incl.)</span>
                        </td>
                      </tr>
                    )}
                    {charges.map((c, i) => (
                      <tr key={`ch-${i}`} style={{ borderTop: "1px solid var(--inv-line)" }}>
                        <td className="p-3 pl-6 text-[var(--inv-muted)]">
                          {c.category}{c.category === "Other" && c.other_description ? ` · ${c.other_description}` : ""}{Number(c.quantity) !== 1 ? ` × ${Number(c.quantity)}` : ""}
                        </td>
                        <td className="p-3 text-right tabular-nums">{inr(Number(c.amount))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Summary block — right-aligned on desktop, full-width on mobile */}
              <div className="mt-3 sm:flex sm:justify-end">
                <div className="w-full sm:max-w-xs text-sm rounded-lg p-3 sm:p-4" style={{ border: "1px solid var(--inv-line)", background: "var(--inv-soft)" }}>
                  <div className="flex justify-between py-1"><span className="text-[var(--inv-muted)]">Subtotal</span><span className="tabular-nums">{inr(itemsTotal + chargesTotal)}</span></div>
                  {discount > 0 && (
                    <div className="flex justify-between py-1"><span className="text-[var(--inv-muted)]">Discount</span><span className="tabular-nums">-{inr(discount)}</span></div>
                  )}
                  <div className="flex justify-between py-1"><span className="text-[var(--inv-muted)]">Taxable</span><span className="tabular-nums">{inr(taxable)}</span></div>
                  <div className="flex justify-between py-1"><span className="text-[var(--inv-muted)]">Tax{taxRate > 0 ? ` (${Math.round(taxRate * 100)}%)` : ""}</span><span className="tabular-nums">{inr(taxes)}</span></div>
                  <div className="flex justify-between py-2 mt-1 border-t" style={{ borderColor: "var(--inv-line)" }}>
                    <span className="font-semibold">Grand Total</span>
                    <span className="tabular-nums font-semibold text-[var(--inv-primary)]" style={{ fontFamily: "'Fraunces', Georgia, serif" }}>{inr(total)}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* ── PAYMENTS ── */}
            <div>
              <div className="text-[10px] uppercase tracking-[0.22em] text-[var(--inv-muted)] mb-2 font-semibold">
                {isFinal ? "Payment Summary" : "Payment History"}
              </div>
              {payments.length > 0 ? (
                <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--inv-line)" }}>
                  {/* Mobile list */}
                  <ul className="sm:hidden divide-y" style={{ borderColor: "var(--inv-line)" }}>
                    {payments.map((p) => (
                      <li key={p.id} className="p-3 text-sm flex justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-[var(--inv-ink)] font-medium truncate">{p.payment_mode}</div>
                          <div className="text-[11px] text-[var(--inv-muted)]">{fmtDateTime(p.occurred_at)}</div>
                        </div>
                        <div className="tabular-nums shrink-0 font-medium">{inr(Number(p.amount))}</div>
                      </li>
                    ))}
                    <li className="p-3 flex justify-between bg-[var(--inv-soft)]">
                      <span className="font-semibold">Total Paid</span>
                      <span className="tabular-nums font-semibold">{inr(sumPayments)}</span>
                    </li>
                  </ul>
                  {/* Desktop */}
                  <table className="hidden sm:table w-full text-sm">
                    <thead>
                      <tr style={{ background: "var(--inv-soft)" }}>
                        <th className="text-left p-3 text-[10px] uppercase tracking-wider text-[var(--inv-muted)] font-semibold">Date</th>
                        <th className="text-left p-3 text-[10px] uppercase tracking-wider text-[var(--inv-muted)] font-semibold">Mode</th>
                        <th className="text-right p-3 text-[10px] uppercase tracking-wider text-[var(--inv-muted)] font-semibold">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {payments.map((p) => (
                        <tr key={p.id} style={{ borderTop: "1px solid var(--inv-line)" }}>
                          <td className="p-3 tabular-nums">{fmtDateTime(p.occurred_at)}</td>
                          <td className="p-3">{p.payment_mode}</td>
                          <td className="p-3 text-right tabular-nums">{inr(Number(p.amount))}</td>
                        </tr>
                      ))}
                      <tr style={{ borderTop: "1px solid var(--inv-line)", background: "var(--inv-soft)" }}>
                        <td className="p-3 font-semibold" colSpan={2}>Total Paid</td>
                        <td className="p-3 text-right tabular-nums font-semibold">{inr(sumPayments)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-[var(--inv-muted)] italic">No payments recorded yet.</p>
              )}
            </div>

            {/* ── SIGNATURE + NOTE ── */}
            <div className="pt-4 grid grid-cols-1 sm:grid-cols-2 gap-4 items-end" style={{ borderTop: "1px solid var(--inv-line)" }}>
              <div className="text-[11px] text-[var(--inv-muted)] leading-relaxed">
                {branding?.invoice_footer ||
                  (isFinal
                    ? "Thank you for staying with Hotel Excella. We hope to welcome you again."
                    : "This is a Proforma Invoice. Final invoice will be issued after checkout.")}
              </div>
              <div className="text-right text-[11px] text-[var(--inv-muted)]">
                {branding?.signature_url ? (
                  <img src={branding.signature_url} alt="Authorised signature"
                    className="ml-auto mb-1 h-14 w-auto max-w-[180px] object-contain bg-white rounded p-1" />
                ) : (
                  <div className="ml-auto mb-1 h-12 w-[160px] border-b border-dashed" style={{ borderColor: "var(--inv-line)" }} />
                )}
                <div className="text-[var(--inv-ink)] font-semibold">
                  {branding?.signatory_designation || "Authorised Signatory"}
                </div>
                <div>{HOTEL.name}</div>
              </div>
            </div>

            {/* Footer micro line */}
            <div className="text-center text-[10px] text-[var(--inv-muted)] tracking-wider pt-2">
              {HOTEL.website} · {HOTEL.phone}
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(node, document.body);
}
