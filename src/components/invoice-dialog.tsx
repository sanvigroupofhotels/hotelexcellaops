import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { MoreVertical, Printer, Share2, Download, X, Building2, Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import type { BookingRow } from "@/lib/bookings-api";
import type { BookingItemRow } from "@/lib/booking-items-api";
import type { BookingPaymentRow } from "@/lib/booking-payments-api";
import type { BookingChargeRow } from "@/lib/booking-charges-api";
import type { BrandingSettings } from "@/lib/branding";
import { invoiceBillingSchema, type InvoiceBilling } from "@/lib/invoice-billing";
import { nodeToBlob } from "@/lib/share-quote";
import { buildInvoiceDocument, invoiceMoney } from "@/lib/invoice-document";
import { getStaffInvoice, updateInvoiceBilling } from "@/lib/invoice.functions";
import { updatePortalInvoiceBilling } from "@/lib/portal.functions";
import { downloadInvoicePdf, printInvoicePdf, prepareInvoicePdf } from "@/lib/invoice-pdf";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

const fmtDate = (s: string) => new Date(s + (s.length === 10 ? "T00:00:00" : "")).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
const inr = (n: number) => `₹${invoiceMoney(n)}`;
interface Presentation {
  branding?: BrandingSettings | null;
  billing?: InvoiceBilling | null;
  roomLabels?: Record<string, string>;
  checkInTime?: string;
  checkOutTime?: string;
  /** Guest portal token — enables guest self-service company/GST edits. */
  portalToken?: string;
}

/** Shared viewer. Staff reads the full folio; portal supplies the same token-scoped payload. */
export function InvoiceDialog({ booking, items = [], payments = [], charges = [], presentation, onClose }: {
  booking: BookingRow; items?: BookingItemRow[]; payments?: BookingPaymentRow[]; charges?: BookingChargeRow[];
  presentation?: Presentation; onClose: () => void;
}) {
  const savePortalBilling = useServerFn(updatePortalInvoiceBilling);
  const [portalBilling, setPortalBilling] = useState<InvoiceBilling | null | undefined>(undefined);
  const docRef = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();
  const readInvoice = useServerFn(getStaffInvoice);
  const saveBilling = useServerFn(updateInvoiceBilling);
  const [editing, setEditing] = useState(false);
  const [company, setCompany] = useState("");
  const [gst, setGst] = useState("");
  const [busy, setBusy] = useState(false);
  const invoice = useQuery({ queryKey: ["staff-invoice", booking.id], queryFn: () => readInvoice({ data: { booking_id: booking.id } }), enabled: !presentation, staleTime: 0 });
  const payload = invoice.data;
  const model = useMemo(() => buildInvoiceDocument(presentation
    ? { booking, items, payments, charges, ...presentation, ...(portalBilling !== undefined ? { billing: portalBilling } : {}) }
    : payload ?? { booking, items, payments, charges }), [booking, items, payments, charges, presentation, payload, portalBilling]);
  const canEditBilling = presentation ? !!presentation.portalToken : !!booking.customer_id;
  const ready = !!presentation || !!payload;
  const { kind, totals } = model;
  const mutation = useMutation({
    mutationFn: () => {
      const parsed = invoiceBillingSchema.parse({ company_name: company, gst_number: gst });
      if (presentation?.portalToken) {
        return savePortalBilling({ data: { token: presentation.portalToken, ...parsed } }).then((d: any) => { setPortalBilling(d?.billing ?? null); return d; });
      }
      return saveBilling({ data: { booking_id: booking.id, ...parsed } });
    },
    onSuccess: async () => {
      if (presentation) { setEditing(false); toast.success("Company details saved"); return; }
      await Promise.all([qc.invalidateQueries({ queryKey: ["staff-invoice", booking.id] }), qc.invalidateQueries({ queryKey: ["customer", booking.customer_id] }), qc.invalidateQueries({ queryKey: ["customers"] })]);
      setEditing(false); toast.success("Guest billing details saved");
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? (e.message.startsWith("[") ? "Enter a valid 15-character GSTIN, or leave it blank." : e.message) : "Could not save company details"),
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const runPdf = async (print: boolean) => {
    setBusy(true);
    try {
      const prepared = await prepareInvoicePdf(model);
      if (print) printInvoicePdf(prepared); else { downloadInvoicePdf(prepared); toast.success("Invoice PDF downloaded"); }
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Could not generate PDF"); }
    finally { setBusy(false); }
  };
  const handleShare = async () => {
    if (!docRef.current) return;
    setBusy(true);
    try {
      const blob = await nodeToBlob(docRef.current);
      if (!blob) throw new Error("Could not render invoice");
      const file = new File([blob], `${model.number}.png`, { type: "image/png" });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: `${model.hotel.name} · ${model.number}` });
      } else {
        const url = URL.createObjectURL(blob); const a = document.createElement("a");
        a.href = url; a.download = file.name; a.click(); URL.revokeObjectURL(url); toast.success("Invoice image saved");
      }
    } catch (e: unknown) {
      if (!(e instanceof Error && e.name === "AbortError")) toast.error(e instanceof Error ? e.message : "Could not share invoice");
    } finally { setBusy(false); }
  };

  return createPortal(
    <div className="invoice-print-portal fixed inset-0 z-[100] flex items-start justify-center overflow-auto bg-invoice-overlay p-2 sm:p-5" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={`${kind} ${model.number}`} className="invoice-modal-shell my-3 w-full max-w-4xl rounded-md border border-border bg-card" onClick={(e) => e.stopPropagation()}>
        <div className="invoice-print-hide flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-3 sm:px-5">
          <div className="min-w-0 text-xs font-medium break-all">{model.number}</div>
          <div className="flex items-center gap-1">
            <Button size="sm" disabled={!ready || busy || mutation.isPending} onClick={() => void runPdf(false)}>{busy ? <Loader2 className="animate-spin" /> : <Download />} Download PDF</Button>
            <DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline" size="icon" aria-label="Invoice actions" disabled={!ready || busy}><MoreVertical /></Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end">{canEditBilling && <DropdownMenuItem onClick={() => { setCompany(model.guest.company ?? ""); setGst(model.guest.gstin ?? ""); setEditing(true); }}><Building2 /> Add / Edit Company Details (GST)</DropdownMenuItem>}<DropdownMenuItem onClick={() => void handleShare()}><Share2 /> Share</DropdownMenuItem><DropdownMenuItem onClick={() => void runPdf(true)}><Printer /> Print</DropdownMenuItem></DropdownMenuContent>
            </DropdownMenu>
            <Button size="icon" variant="ghost" aria-label="Close invoice" onClick={onClose}><X /></Button>
          </div>
        </div>
        {editing && <form className="invoice-print-hide grid gap-3 border-b border-border p-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); mutation.mutate(); }}>
          <label className="space-y-1 text-xs">Company Name<input aria-label="Company Name" maxLength={200} className="block w-full rounded-md border border-input bg-background p-2 text-sm" value={company} onChange={(e) => setCompany(e.target.value)} /></label>
          <label className="space-y-1 text-xs">Guest GSTIN<input aria-label="Guest GSTIN" maxLength={15} className="block w-full rounded-md border border-input bg-background p-2 text-sm uppercase" value={gst} onChange={(e) => setGst(e.target.value.toUpperCase())} /></label>
          <div className="flex justify-end gap-2 sm:col-span-2"><Button variant="ghost" size="sm" type="button" onClick={() => setEditing(false)}>Cancel</Button><Button size="sm" disabled={mutation.isPending}>{mutation.isPending ? <Loader2 className="animate-spin" /> : <Save />} Save Details</Button></div>
        </form>}
        {!ready ? <div className="flex min-h-48 items-center justify-center gap-2 p-5 text-sm">{invoice.isError ? <><span>Could not load invoice.</span><Button size="sm" variant="outline" onClick={() => void invoice.refetch()}>Retry</Button></> : <><Loader2 className="h-5 w-5 animate-spin" /> Loading invoice…</>}</div> :
        <div ref={docRef} className="invoice-document bg-invoice-paper p-4 text-invoice-ink sm:p-8" data-invoice-print>
          <div className="flex flex-col gap-4 border-b border-invoice-rule pb-5 sm:flex-row sm:items-start">
            {model.hotel.logo_url && <img src={model.hotel.logo_url} alt={`${model.hotel.name} logo`} className="h-16 w-24 shrink-0 object-contain" />}
            <div className="min-w-0 space-y-1 text-xs break-words"><h2 className="text-lg font-bold sm:text-xl">{model.hotel.legal_name || model.hotel.name}</h2>{model.hotel.legal_name && <p className="text-sm">(Unit: {model.hotel.name})</p>}<p className="max-w-xl text-invoice-muted">{model.hotel.address}</p><p>{model.hotel.gstin && `GSTIN: ${model.hotel.gstin}`}{model.hotel.phone && ` · Ph: ${model.hotel.phone}`}</p><p className="text-invoice-muted">{[model.hotel.email, model.hotel.website].filter(Boolean).join(" · ")}</p></div>
          </div>
          <div className="flex flex-col-reverse justify-between gap-3 border-b border-invoice-rule py-4 sm:flex-row sm:items-center"><div className="space-y-1 text-xs"><p><b>Invoice No:</b> {model.number}</p><p><b>Invoice Date:</b> {fmtDate(model.issuedAt)}</p><p><b>Booking Ref:</b> {booking.booking_reference}</p></div><h1 className="text-2xl font-bold sm:text-right">{kind}</h1></div>
          <div className="grid gap-4 py-5 text-xs sm:grid-cols-2"><div className="space-y-1 break-words"><h3 className="mb-2 font-bold">BILL TO</h3><p className="text-sm font-semibold">{model.guest.name}</p>{model.guest.company && <p>{model.guest.company}</p>}{model.guest.address && <p>{model.guest.address}</p>}{model.guest.gstin && <p>GSTIN: {model.guest.gstin}</p>}<p className="text-invoice-muted">{[model.guest.phone, model.guest.email].filter(Boolean).join(" · ")}</p></div><div className="space-y-1"><h3 className="mb-2 font-bold">STAY DETAILS</h3><p>Check In: {fmtDate(model.stay.checkIn)} · {model.stay.checkInTime}</p><p>Check Out: {fmtDate(model.stay.checkOut)} · {model.stay.checkOutTime}</p><p>{model.stay.nights} night(s) · {model.stay.adults} adult(s){model.stay.children > 0 && ` · ${model.stay.children} child(ren)`}</p></div></div>
          <div className="overflow-x-auto"><table className="w-full min-w-[650px] table-fixed border-collapse border border-invoice-rule text-[10px]"><colgroup><col className="w-[4%]" /><col className="w-[29%]" /><col className="w-[11%]" /><col className="w-[11%]" /><col className="w-[9%]" /><col className="w-[9%]" /><col className="w-[13%]" /><col className="w-[14%]" /></colgroup><thead className="bg-invoice-band"><tr>{["#", "Description / SAC", "Check In", "Check Out", "Room(s)", "Days / Qty", "Rate", "Amount"].map((h) => <th key={h} className="border border-invoice-rule p-2 text-left last:text-right">{h}</th>)}</tr></thead><tbody>{model.tableLines.map((r, i) => <tr key={i}><td className="border border-invoice-rule p-2 align-top">{i + 1}</td><td className="border border-invoice-rule p-2 break-words align-top">{r.description}{r.sac && <p className="mt-1 text-invoice-muted">SAC: {r.sac}</p>}</td><td className="border border-invoice-rule p-2 align-top">{r.checkIn ? fmtDate(r.checkIn) : "—"}</td><td className="border border-invoice-rule p-2 align-top">{r.checkOut ? fmtDate(r.checkOut) : "—"}</td><td className="border border-invoice-rule p-2 break-words align-top">{r.rooms || "—"}</td><td className="border border-invoice-rule p-2 align-top">{r.qty}<p className="text-[9px] text-invoice-muted">{r.unit}</p></td><td className="border border-invoice-rule p-2 text-right align-top tabular-nums">{invoiceMoney(r.rate)}</td><td className="border border-invoice-rule p-2 text-right align-top tabular-nums">{invoiceMoney(r.amount)}</td></tr>)}</tbody></table></div>
          <div className="grid gap-6 py-5 sm:grid-cols-2"><div className="space-y-4 text-xs"><div><h3 className="mb-1 font-bold">TOTAL IN WORDS</h3><p className="leading-relaxed">{model.amountInWords}</p></div><div><h3 className="mb-1 font-bold">NOTES</h3>{!model.isFinal && <p className="mb-2">This proforma is not a tax invoice. Final invoice is issued after checkout.</p>}<p className="leading-relaxed text-invoice-muted">{model.footer}</p></div></div><div className="space-y-2 text-xs"><TotalRow label="Sub Total" value={totals.subtotal} />{totals.discount > 0 && <TotalRow label={`Discount${totals.discountPercent ? ` (${totals.discountPercent}%)` : ""}`} value={-totals.discount} />}<TotalRow label="Taxable Amount" value={totals.taxable} />{model.taxLines.map((t) => <TotalRow key={t.label} label={`${t.label} (${t.rate}%)`} value={t.amount} />)}<div className="border-y border-invoice-rule bg-invoice-band px-2 py-3 text-sm font-bold"><TotalRow label="Total" value={totals.total} /></div><TotalRow label="Payment Made" value={totals.paid} /><div className="border-t border-invoice-rule pt-2 font-bold"><TotalRow label={totals.isCredit ? "Guest Credit" : "Balance Due"} value={Math.abs(totals.balance)} /></div></div></div>
          <div className="grid items-end gap-6 border-t border-invoice-rule pt-5 text-xs sm:grid-cols-2"><div><h3 className="mb-2 font-bold">PAYMENTS RECEIVED</h3>{model.payments.length ? <div className="space-y-1">{model.payments.map((p, i) => <div key={i} className="flex flex-wrap justify-between gap-x-3"><span className="text-invoice-muted">{fmtDate(p.date)} · {p.mode}</span><span className="tabular-nums">{inr(p.amount)}</span></div>)}</div> : <p className="text-invoice-muted">No payments recorded.</p>}</div><div className="text-right">{model.signature.url ? <img src={model.signature.url} alt="Authorised signature" className="mb-1 ml-auto h-14 w-40 object-contain" /> : <div className="mb-2 ml-auto h-12 w-40 border-b border-invoice-rule" />}<p className="font-semibold">{model.signature.designation}</p><p className="mt-1 text-invoice-muted">{model.hotel.legal_name || model.hotel.name}</p></div></div>
          <p className="mt-6 border-t border-invoice-rule pt-3 text-[10px] text-invoice-muted">All amounts in INR · {model.number}</p>
        </div>}
      </div>
    </div>, document.body,
  );
}
function TotalRow({ label, value }: { label: string; value: number }) { return <div className="flex justify-between gap-3"><span>{label}</span><span className="whitespace-nowrap tabular-nums">{inr(value)}</span></div>; }

/** Reception: add/edit the guest's company name and GSTIN without opening the invoice. */
export function CompanyBillingDialog({ bookingId, customerId, onClose }: { bookingId: string; customerId: string | null; onClose: () => void }) {
  const qc = useQueryClient();
  const readInvoice = useServerFn(getStaffInvoice);
  const saveBilling = useServerFn(updateInvoiceBilling);
  const current = useQuery({ queryKey: ["staff-invoice", bookingId], queryFn: () => readInvoice({ data: { booking_id: bookingId } }), staleTime: 0 });
  const [company, setCompany] = useState<string | null>(null);
  const [gst, setGst] = useState<string | null>(null);
  const companyValue = company ?? current.data?.billing?.company_name ?? "";
  const gstValue = gst ?? current.data?.billing?.gst_number ?? "";
  const mutation = useMutation({
    mutationFn: () => saveBilling({ data: { booking_id: bookingId, ...invoiceBillingSchema.parse({ company_name: companyValue, gst_number: gstValue }) } }),
    onSuccess: async () => {
      await Promise.all([qc.invalidateQueries({ queryKey: ["staff-invoice", bookingId] }), qc.invalidateQueries({ queryKey: ["customer", customerId] }), qc.invalidateQueries({ queryKey: ["customers"] })]);
      toast.success("Company details saved"); onClose();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? (e.message.startsWith("[") ? "Enter a valid 15-character GSTIN, or leave it blank." : e.message) : "Could not save company details"),
  });
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-invoice-overlay p-3" onClick={onClose}>
      <form role="dialog" aria-modal="true" aria-label="Company Details (GST)" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); mutation.mutate(); }} className="luxe-card w-full max-w-md space-y-4 rounded-xl border border-border bg-card p-5">
        <div className="flex items-center justify-between"><h2 className="font-display text-base flex items-center gap-2"><Building2 className="h-4 w-4 text-gold" /> Company Details (GST)</h2><Button size="icon" variant="ghost" type="button" aria-label="Close" onClick={onClose}><X /></Button></div>
        <p className="text-xs text-muted-foreground">Saved to the guest profile and shown on every invoice for this guest.</p>
        {current.isLoading ? <div className="flex justify-center py-6"><Loader2 className="animate-spin" /></div> : <>
          <label className="block space-y-1 text-xs">Company Name<input aria-label="Company Name" maxLength={200} className="block w-full rounded-md border border-input bg-background p-2 text-sm" value={companyValue} onChange={(e) => setCompany(e.target.value)} /></label>
          <label className="block space-y-1 text-xs">Guest GSTIN<input aria-label="Guest GSTIN" maxLength={15} className="block w-full rounded-md border border-input bg-background p-2 text-sm uppercase" value={gstValue} onChange={(e) => setGst(e.target.value.toUpperCase())} /></label>
        </>}
        <div className="flex justify-end gap-2"><Button variant="ghost" size="sm" type="button" onClick={onClose}>Cancel</Button><Button size="sm" disabled={mutation.isPending || current.isLoading || !customerId}>{mutation.isPending ? <Loader2 className="animate-spin" /> : <Save />} Save Details</Button></div>
      </form>
    </div>, document.body,
  );
}
