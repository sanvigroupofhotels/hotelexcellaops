import { useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { MoreVertical, Printer, Share2, Download, X } from "lucide-react";
import { toast } from "sonner";
import type { BookingRow } from "@/lib/bookings-api";
import type { BookingItemRow } from "@/lib/booking-items-api";
import type { BookingPaymentRow } from "@/lib/booking-payments-api";
import type { BookingChargeRow } from "@/lib/booking-charges-api";
import { nodeToBlob } from "@/lib/share-quote";
import { useOpsTimeLabels } from "@/lib/check-times";
import { getBrandingSettings } from "@/lib/app-settings-api";
import { buildInvoiceDocument } from "@/lib/invoice-document";
import { downloadInvoicePdf, printInvoicePdf } from "@/lib/invoice-pdf";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const fmtDate = (s: string) =>
  new Date(s + (s.length === 10 ? "T00:00:00" : "")).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
const fmtDateTime = (s: string) =>
  new Date(s).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" });
const inr = (n: number) => `₹${Math.round(Number(n) || 0).toLocaleString("en-IN")}`;

/**
 * Invoice / Proforma viewer for a booking.
 *
 * The document content comes from the shared invoice engine
 * (`invoice-document.ts`), so this modal, the downloaded A4 PDF and the printed
 * copy are always the same document. Actions live in a single ⋮ menu:
 *   Share (image, existing HEOS share flow) · Print (prints the PDF) ·
 *   Download PDF (saves a real PDF — never window.print()).
 */
export function InvoiceDialog({
  booking, items = [], payments = [], charges = [], onClose,
}: {
  booking: BookingRow;
  items?: BookingItemRow[];
  payments?: BookingPaymentRow[];
  charges?: BookingChargeRow[];
  onClose: () => void;
}) {
  const docRef = useRef<HTMLDivElement>(null);
  const checkTimes = useOpsTimeLabels();
  const { data: branding } = useQuery({ queryKey: ["branding-settings"], queryFn: getBrandingSettings });

  const model = useMemo(
    () => buildInvoiceDocument({
      booking, items, payments, charges, branding,
      checkInTime: checkTimes.checkIn, checkOutTime: checkTimes.checkOut,
    }),
    [booking, items, payments, charges, branding, checkTimes.checkIn, checkTimes.checkOut],
  );
  const { kind, isFinal, totals } = model;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleDownload = () => {
    try {
      downloadInvoicePdf(model);
      toast.success(`${isFinal ? "Invoice" : "Proforma invoice"} PDF downloaded`);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not generate PDF");
    }
  };

  const handlePrint = () => {
    try {
      printInvoicePdf(model);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not open print");
    }
  };

  const handleShare = async () => {
    if (!docRef.current) return;
    try {
      const blob = await nodeToBlob(docRef.current);
      if (!blob) throw new Error("Could not render invoice");
      const filename = `${model.number}.png`;
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
            title: `${model.hotel.name} · ${kind} · ${booking.booking_reference}`,
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
        className="invoice-modal-shell luxe-card rounded-2xl w-full max-w-3xl my-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Toolbar — one ⋮ menu keeps Booking Detail clean (hidden on print) */}
        <div className="invoice-print-hide flex items-center justify-between gap-2 px-4 py-3 border-b border-border">
          <div className="text-sm font-medium">{kind} · {model.number}</div>
          <div className="flex items-center gap-1">
            <button onClick={handleDownload}
              className="inline-flex items-center gap-2 rounded-md gold-gradient px-3 py-2 text-xs font-medium text-charcoal">
              <Download className="h-3.5 w-3.5" /> Download PDF
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="p-2 rounded-md border border-border bg-card text-muted-foreground hover:text-foreground hover:border-gold/40"
                  aria-label="Invoice actions">
                  <MoreVertical className="h-4 w-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem onClick={handleShare}>
                  <Share2 className="h-3.5 w-3.5 text-gold" /> Share
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handlePrint}>
                  <Printer className="h-3.5 w-3.5 text-gold" /> Print
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleDownload}>
                  <Download className="h-3.5 w-3.5 text-gold" /> Download PDF
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <button onClick={onClose} className="p-2 text-muted-foreground hover:text-foreground" aria-label="Close">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Document body — compact single-page layout, mirrors the PDF */}
        <div ref={docRef} className="p-5 md:p-7 bg-card text-foreground text-sm" data-invoice-print>
          {/* Header */}
          <div className="flex items-start justify-between gap-4 pb-3 border-b border-border">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-md gold-gradient flex items-center justify-center shrink-0">
                <span className="font-display text-lg font-semibold text-charcoal">H</span>
              </div>
              <div className="leading-tight">
                <div className="font-display text-base">{model.hotel.name}</div>
                <div className="text-[10px] text-muted-foreground">{model.hotel.address} · {model.hotel.phone}</div>
                <div className="text-[10px] text-muted-foreground">{model.hotel.email} · GSTIN: {model.hotel.gstin}</div>
              </div>
            </div>
            <div className="text-right leading-tight">
              <h2 className="font-display text-xl gold-text-gradient">{kind}</h2>
              <div className="text-[10px] text-muted-foreground">No: {model.number}</div>
              <div className="text-[10px] text-muted-foreground">Date: {fmtDate(model.issuedAt)}</div>
            </div>
          </div>

          {/* Guest + Stay — two columns, no repeated room info */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 py-3 border-b border-border">
            <div>
              <h4 className="text-[9px] uppercase tracking-[0.22em] text-gold mb-1">Billed To</h4>
              <div className="font-medium">{model.guest.name}</div>
              <div className="text-[11px] text-muted-foreground">
                {[model.guest.phone, model.guest.email].filter(Boolean).join(" · ")}
              </div>
              <div className="text-[11px] text-muted-foreground">Booking Ref: {booking.booking_reference}</div>
            </div>
            <div>
              <h4 className="text-[9px] uppercase tracking-[0.22em] text-gold mb-1">Stay Details</h4>
              <div className="font-medium">
                {fmtDate(model.stay.checkIn)} → {fmtDate(model.stay.checkOut)} ({model.stay.nights}N)
              </div>
              <div className="text-[11px] text-muted-foreground">
                {model.stay.adults} Adult{model.stay.adults === 1 ? "" : "s"}
                {model.stay.children > 0 ? ` + ${model.stay.children} Child${model.stay.children === 1 ? "" : "ren"}` : ""}
                {" · "}In {checkTimes.checkIn} · Out {checkTimes.checkOut}
              </div>
              <div className="text-[11px] text-muted-foreground">
                {model.roomLines.map((r) => `${r.qty} × ${r.label}`).join(", ")}
              </div>
            </div>
          </div>

          {/* Charges */}
          <div className="py-3 border-b border-border">
            <h4 className="text-[9px] uppercase tracking-[0.22em] text-gold mb-1.5">Accommodation</h4>
            <table className="w-full">
              <tbody>
                {model.roomLines.map((r, i) => (
                  <tr key={`rm-${i}`} className="border-b border-border/40">
                    <td className="py-1">
                      {r.qty > 1 ? `${r.qty} × ` : ""}{r.label}
                      <span className="text-muted-foreground text-[11px]">
                        {r.nights ? ` · ${r.nights}N` : ""}{r.rate ? ` · ${inr(r.rate)}/night` : ""}
                      </span>
                      {r.detail && <div className="text-[10px] text-muted-foreground">{r.detail}</div>}
                    </td>
                    <td className="py-1 text-right tabular-nums">{inr(r.amount)}</td>
                  </tr>
                ))}
                {model.extraLines.length > 0 && (
                  <tr><td className="pt-2 pb-0.5 text-[9px] uppercase tracking-[0.22em] text-gold" colSpan={2}>Additional Stay Charges</td></tr>
                )}
                {model.extraLines.map((e, i) => (
                  <tr key={`ex-${i}`} className="border-b border-border/40">
                    <td className="py-1 pl-3 text-muted-foreground">{e.label}</td>
                    <td className="py-1 text-right tabular-nums">{inr(e.value)}</td>
                  </tr>
                ))}
                {model.chargeLines.length > 0 && (
                  <tr><td className="pt-2 pb-0.5 text-[9px] uppercase tracking-[0.22em] text-gold" colSpan={2}>In-House Charges (tax incl.)</td></tr>
                )}
                {model.chargeLines.map((c, i) => (
                  <tr key={`ch-${i}`} className="border-b border-border/40">
                    <td className="py-1 pl-3 text-muted-foreground">
                      {c.label}{c.qty !== 1 ? ` × ${c.qty}` : ""}{c.room ? ` — ${c.room}` : ""}
                    </td>
                    <td className="py-1 text-right tabular-nums">{inr(c.amount)}</td>
                  </tr>
                ))}
                <tr className="border-b border-border/40">
                  <td className="py-1 font-medium">Subtotal</td>
                  <td className="py-1 text-right tabular-nums">{inr(totals.subtotal)}</td>
                </tr>
                {totals.discount > 0 && (
                  <tr className="border-b border-border/40">
                    <td className="py-1">Discount</td>
                    <td className="py-1 text-right tabular-nums">-{inr(totals.discount)}</td>
                  </tr>
                )}
                <tr className="border-b border-border/40">
                  <td className="py-1 text-muted-foreground">Taxable Amount</td>
                  <td className="py-1 text-right tabular-nums">{inr(totals.taxable)}</td>
                </tr>
                <tr className="border-b border-border/40">
                  <td className="py-1 text-muted-foreground">Tax{totals.taxRate > 0 ? ` (${Math.round(totals.taxRate * 100)}%)` : ""}</td>
                  <td className="py-1 text-right tabular-nums">{inr(totals.taxes)}</td>
                </tr>
                <tr>
                  <td className="pt-2 font-medium">{isFinal ? "Total Invoice Amount" : "Total Payable"}</td>
                  <td className="pt-2 text-right font-display text-base gold-text-gradient tabular-nums">{inr(totals.total)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Payments + balance */}
          <div className="py-3 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
            <div>
              <h4 className="text-[9px] uppercase tracking-[0.22em] text-gold mb-1.5">
                {isFinal ? "Payment Summary" : "Payments Received"}
              </h4>
              {model.payments.length > 0 ? (
                <table className="w-full text-[12px]">
                  <tbody>
                    {model.payments.map((p, i) => (
                      <tr key={`p-${i}`} className="border-b border-border/40">
                        <td className="py-0.5 text-muted-foreground tabular-nums">{fmtDateTime(p.date)}</td>
                        <td className="py-0.5 text-muted-foreground">{p.mode}</td>
                        <td className="py-0.5 text-right tabular-nums">{inr(p.amount)}</td>
                      </tr>
                    ))}
                    <tr>
                      <td className="pt-1 font-medium" colSpan={2}>Total Paid</td>
                      <td className="pt-1 text-right tabular-nums">{inr(model.paymentsTotal)}</td>
                    </tr>
                  </tbody>
                </table>
              ) : (
                <p className="text-[12px] text-muted-foreground italic">No payments recorded yet.</p>
              )}
            </div>
            <div className="flex flex-col gap-1 self-start">
              <div className="flex justify-between"><span className="text-muted-foreground">Total Amount</span><span className="tabular-nums">{inr(totals.total)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Amount Paid</span><span className="tabular-nums">{inr(totals.paid)}</span></div>
              <div className="flex justify-between border-t border-border pt-1.5">
                <span className="font-medium">{totals.isCredit ? "Guest Credit" : (isFinal ? "Outstanding Balance" : "Balance Due")}</span>
                <span className={cn("font-display text-base tabular-nums", totals.isCredit ? "text-success" : "gold-text-gradient")}>
                  {inr(Math.abs(totals.balance))}
                </span>
              </div>
            </div>
          </div>

          {/* Footer + signature — reserved, always on the same page as the PDF */}
          <div className="pt-3 border-t border-border grid grid-cols-1 sm:grid-cols-2 gap-4 items-end">
            <div className="text-[10px] text-muted-foreground">{model.footer}</div>
            <div className="text-right text-[10px] text-muted-foreground">
              {model.signature.url ? (
                <img src={model.signature.url} alt="Authorised signature"
                  className="ml-auto mb-1 h-12 w-auto max-w-[160px] object-contain bg-white rounded p-1" />
              ) : (
                <div className="ml-auto mb-1 h-12 w-[150px] border-b border-dashed border-border" />
              )}
              <div className="text-foreground font-medium">{model.signature.designation}</div>
              <div>{model.hotel.name}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(node, document.body);
}
