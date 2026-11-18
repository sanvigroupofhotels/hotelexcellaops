/**
 * Shared invoice document engine.
 *
 * ONE model powers every invoice surface in HEOS:
 *   - the on-screen Invoice / Proforma modal (`invoice-dialog.tsx`)
 *   - the downloaded A4 PDF (`invoice-pdf.ts`)
 *   - the printed copy (prints the same generated PDF)
 *   - the Guest Portal (same dialog, same model)
 *
 * Proforma vs Final Invoice is a *flag on this model*, never a second
 * implementation: the only differences are the document title, the issue/date
 * metadata and the footer/terms wording.
 *
 * Financial model stays booking-level (the whole booking is one invoice), while
 * room lines and room-specific charges keep their Booking Item attribution.
 */
import type { BookingRow } from "@/lib/bookings-api";
import type { BookingItemRow } from "@/lib/booking-items-api";
import { rowToLineItem } from "@/lib/booking-items-api";
import type { BookingPaymentRow } from "@/lib/booking-payments-api";
import type { BookingChargeRow } from "@/lib/booking-charges-api";
import { computePricing } from "@/lib/pricing";
import { resolveBranding, type BrandingSettings, type HotelIdentity } from "@/lib/branding";
import type { InvoiceBilling } from "@/lib/invoice-billing";

export const ACCOMMODATION_SAC = "996311";
export const invoiceMoney = (n: number) => Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const roundMoney = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const small = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
function integerWords(n: number): string {
  if (n < 20) return small[n] ?? "Zero";
  if (n < 100) return [tens[Math.floor(n / 10)], n % 10 ? integerWords(n % 10) : ""].filter(Boolean).join(" ");
  for (const [size, name] of [[10000000, "Crore"], [100000, "Lakh"], [1000, "Thousand"], [100, "Hundred"]] as const) {
    if (n >= size) return `${integerWords(Math.floor(n / size))} ${name}${n % size ? ` ${size === 100 ? "and " : ""}${integerWords(n % size)}` : ""}`;
  }
  return "Zero";
}
export function numberToWordsINR(amount: number): string {
  const paise = Math.round(Math.abs(amount) * 100);
  return `Indian Rupee ${integerWords(Math.floor(paise / 100))}${paise % 100 ? ` and ${integerWords(paise % 100)} Paise` : ""} Only`;
}

/** Accommodation place of supply is the hotel, not the guest's GST state. */
export function splitInvoiceGst(taxes: number, rate: number) {
  const cgst = roundMoney(taxes / 2);
  return [
    { label: "CGST", rate: rate * 50, amount: cgst },
    { label: "SGST", rate: rate * 50, amount: roundMoney(taxes - cgst) },
  ];
}

export interface InvoiceRoomLine {
  /** e.g. "Maple Room" */
  label: string;
  /** number of rooms represented by this line */
  qty: number;
  nights: number;
  rate: number;
  amount: number;
  /** Occupant / assigned-room hints, comma joined (kept compact). */
  detail: string;
  /** Booking item ids folded into this line — attribution is preserved. */
  itemIds: string[];
  checkIn: string;
  checkOut: string;
  roomNumbers: string[];
}

export interface InvoiceChargeLine {
  label: string;
  /** System-calculated amount before a Reception override (audit trail). */
  standardAmount?: number;
  /** Negotiated reduction = standardAmount − amount. */
  discount?: number;
  /** Room attribution ("Maple Room 2") or "" for booking-level charges. */
  room: string;
  qty: number;
  amount: number;
  itemId: string | null;
}

export interface InvoicePaymentLine {
  date: string;
  mode: string;
  amount: number;
}

export interface InvoiceDocModel {
  kind: "TAX INVOICE" | "PROFORMA INVOICE";
  isFinal: boolean;
  /** Invoice number — booking reference based, stable per booking. */
  number: string;
  /** ISO date the document was issued. */
  issuedAt: string;
  hotel: HotelIdentity;
  guest: { name: string; phone: string | null; email: string | null; company: string | null; gstin: string | null; address: string | null };
  taxLines: { label: string; rate: number; amount: number }[];
  amountInWords: string;
  tableLines: InvoiceTableLine[];
  stay: {
    checkIn: string;
    checkOut: string;
    nights: number;
    adults: number;
    children: number;
    checkInTime?: string;
    checkOutTime?: string;
  };
  roomLines: InvoiceRoomLine[];
  extraLines: { label: string; value: number }[];
  chargeLines: InvoiceChargeLine[];
  totals: {
    itemsTotal: number;
    chargesTotal: number;
    subtotal: number;
    discount: number;
    taxable: number;
    taxRate: number;
    taxes: number;
    total: number;
    paid: number;
    /** Signed: negative means the guest overpaid (Guest Credit). */
    balance: number;
    isCredit: boolean;
  };
  payments: InvoicePaymentLine[];
  paymentsTotal: number;
  footer: string;
  signature: { url: string | null; designation: string };
}

export interface BuildInvoiceInput {
  booking: BookingRow;
  items?: BookingItemRow[];
  payments?: BookingPaymentRow[];
  charges?: BookingChargeRow[];
  branding?: Partial<{ [K in keyof BrandingSettings]: BrandingSettings[K] | null }> | null;
  billing?: InvoiceBilling | null;
  checkInTime?: string;
  checkOutTime?: string;
  /** Optional map of booking_item id → room number label, for charge attribution. */
  roomLabels?: Record<string, string>;
  /** Override issue timestamp (tests). */
  now?: Date;
}

export interface InvoiceTableLine {
  description: string; sac: string; checkIn: string; checkOut: string;
  rooms: string; qty: number; unit: string; rate: number; amount: number;
}

const num = (v: unknown) => Number(v) || 0;

function itemRoomLabel(it: BookingItemRow, roomLabels?: Record<string, string>) {
  const room = roomLabels?.[it.id];
  return room ? `${it.room_type} ${room}` : it.room_type;
}

/**
 * Collapse booking items into compact invoice room lines.
 * Identical room type / rate / dates fold into a single "3 × Maple Room" line
 * so a 12-room group booking still prints as a handful of rows.
 */
export function buildRoomLines(
  items: BookingItemRow[],
  roomLabels?: Record<string, string>,
): InvoiceRoomLine[] {
  const groups = new Map<string, InvoiceRoomLine>();
  for (const it of items) {
    if (it.item_status === "Removed" || it.item_status === "Cancelled") continue;
    const nights = num(it.nights) || 1;
    const rate = num(it.rate);
    const key = `${it.room_type}|${rate}|${it.check_in}|${it.check_out}`;
    const qty = Math.max(1, num(it.rooms) || 1);
    const detailBits = [it.primary_occupant_name, roomLabels?.[it.id]].filter(Boolean) as string[];
    const existing = groups.get(key);
    if (existing) {
      existing.qty += qty;
      existing.amount += rate * nights * qty;
      existing.itemIds.push(it.id);
      if (roomLabels?.[it.id]) existing.roomNumbers.push(roomLabels[it.id]);
      if (detailBits.length) existing.detail = [existing.detail, detailBits.join(" ")].filter(Boolean).join(", ");
    } else {
      groups.set(key, {
        label: it.room_type,
        qty,
        nights,
        rate,
        amount: rate * nights * qty,
        detail: detailBits.join(" "),
        itemIds: [it.id],
        checkIn: it.check_in,
        checkOut: it.check_out,
        roomNumbers: roomLabels?.[it.id] ? [roomLabels[it.id]] : [],
      });
    }
  }
  return [...groups.values()];
}

/** Booking charges as invoice lines, keeping per-room (booking item) attribution. */
export function buildChargeLines(
  charges: BookingChargeRow[],
  items: BookingItemRow[],
  roomLabels?: Record<string, string>,
): InvoiceChargeLine[] {
  const byItem = new Map(items.map((i) => [i.id, i]));
  return charges.map((c) => {
    const it = c.item_id ? byItem.get(c.item_id) : undefined;
    const baseLabel =
      c.category === "Other" && c.other_description ? `${c.category} · ${c.other_description}` : c.category;
    // Negotiated Early/Late services print the existing discount pattern:
    // Standard → Discount → Net, on the same line (presentation only).
    const qty = num(c.quantity) || 1;
    const amount = num(c.amount);
    const standardAmount = c.price_overridden
      ? Number((num(c.standard_unit_price) * qty).toFixed(2))
      : amount;
    const discount = Math.max(0, Number((standardAmount - amount).toFixed(2)));
    return {
      label: discount > 0 ? `${baseLabel} (Negotiated)` : baseLabel,
      ...(discount > 0 ? { standardAmount, discount } : {}),
      room: it ? itemRoomLabel(it, roomLabels) : "",
      qty,
      amount,
      itemId: c.item_id ?? null,
    };
  });
}

/**
 * Canonical invoice/proforma document model. Every number here comes from the
 * shared pricing engine so the document always matches Booking Detail.
 */
export function buildInvoiceDocument(input: BuildInvoiceInput): InvoiceDocModel {
  const { booking, items = [], payments = [], charges = [], branding, roomLabels, billing } = input;
  const identity = resolveBranding(branding);
  const isFinal = ["Checked-Out", "Stay Completed"].includes(booking.status as string);
  const discount = num((booking as any).discount);
  const taxRate = num((booking as any).tax_rate);

  let pricing: ReturnType<typeof computePricing> | null = null;
  if (items.length) {
    try {
      pricing = computePricing(items.filter((i) => i.item_status !== "Removed" && i.item_status !== "Cancelled").map(rowToLineItem), discount, taxRate, {
        totalOverride: (booking as any).total_override ?? null,
        taxesIncluded: !!(booking as any).taxes_included,
      });
    } catch { pricing = null; }
  }

  const bookingAmount = num(booking.amount);
  const chargesTotal = charges.reduce((s, c) => s + num(c.amount), 0);
  const total = bookingAmount + chargesTotal;
  const paid = num(booking.advance_paid);
  const balance = total - paid;
  const itemsTotal = pricing?.itemsTotal ?? Math.max(0, bookingAmount + discount - num((booking as any).taxes));
  const taxes = pricing?.taxes ?? num((booking as any).taxes);
  // Authoritative discount = whatever the shared pricing engine resolved. This
  // covers the manual discount field AND an implicit discount derived from a
  // negotiated total override (override < computed items total). Never inferred
  // here — the PDF/document layer is presentation only.
  const effectiveDiscount = pricing ? pricing.discount : discount;
  // Taxable includes post-stay charges so that Taxable + Tax = Total on the
  // document, matching the booking-level arithmetic exactly.
  const taxable = roundMoney(bookingAmount - taxes + chargesTotal);


  const roomLines = buildRoomLines(items, roomLabels);
  // When there are no booking items (legacy bookings) fall back to a single
  // summary stay line so the document is never empty.
  if (!roomLines.length) {
    roomLines.push({
      label: booking.room_details || "Accommodation",
      qty: 1,
      nights: num(booking.nights) || 1,
      rate: itemsTotal / (num(booking.nights) || 1),
      amount: itemsTotal,
      detail: "",
      itemIds: [],
      checkIn: booking.check_in,
      checkOut: booking.check_out,
      roomNumbers: [],
    });
  }

  const extraLines = (pricing?.additionalLineItems ?? []).map((x) => ({
    label: (x.discount ?? 0) > 0
      ? `${x.label} · Negotiated (Std INR ${invoiceMoney(x.standardValue ?? x.value)}, Disc INR ${invoiceMoney(x.discount ?? 0)})`
      : x.label,
    value: x.value,
  }));
  const chargeLines = buildChargeLines(charges, items, roomLabels);
  const netFactor = booking.taxes_included ? 1 / (1 + taxRate) : 1;
  const netDiscount = roundMoney(effectiveDiscount * netFactor);
  const tableLines: InvoiceTableLine[] = roomLines.map((r) => ({
    description: `${r.label}${r.detail ? ` · ${r.detail}` : ""}`,
    sac: ACCOMMODATION_SAC, checkIn: r.checkIn, checkOut: r.checkOut,
    rooms: [...new Set(r.roomNumbers)].join(", "), qty: r.qty * r.nights, unit: "Room-days",
    rate: roundMoney(r.rate * netFactor), amount: roundMoney(r.amount * netFactor),
  }));
  tableLines.push(...extraLines.map((e) => ({
    description: e.label, sac: ACCOMMODATION_SAC, checkIn: "", checkOut: "", rooms: "",
    qty: 1, unit: "Service", rate: roundMoney(e.value * netFactor), amount: roundMoney(e.value * netFactor),
  })), ...chargeLines.map((c) => ({
    description: c.label, sac: "", checkIn: "", checkOut: "", rooms: c.room,
    qty: c.qty, unit: "Units", rate: roundMoney(c.amount / c.qty), amount: c.amount,
  })));
  // Negotiated or overridden stay totals are absorbed into the room lines so the
  // document never shows an artificial "adjustment" row. The folio total is
  // unchanged: room amounts are scaled proportionally and rates re-derived.
  const roomCount = roomLines.length;
  const adjustment = roundMoney(taxable + netDiscount - tableLines.reduce((s, r) => s + r.amount, 0));
  if (Math.abs(adjustment) >= 0.01 && roomCount) {
    const roomRows = tableLines.slice(0, roomCount);
    const roomSum = roomRows.reduce((s, r) => s + r.amount, 0);
    let remaining = adjustment;
    roomRows.forEach((r, i) => {
      const share = i === roomCount - 1 ? remaining : roundMoney(roomSum > 0 ? adjustment * (r.amount / roomSum) : adjustment / roomCount);
      remaining = roundMoney(remaining - share);
      r.amount = roundMoney(r.amount + share);
      r.rate = roundMoney(r.qty > 0 ? r.amount / r.qty : r.amount);
    });
  }

  return {
    kind: isFinal ? "TAX INVOICE" : "PROFORMA INVOICE",
    isFinal,
    number: isFinal ? `INV-${booking.booking_reference}` : `PI-${booking.booking_reference}`,
    issuedAt: (input.now ?? new Date()).toISOString(),
    hotel: identity,
    guest: { name: booking.guest_name, phone: booking.phone ?? null, email: booking.email ?? null,
      company: billing?.company_name ?? null, gstin: billing?.gst_number ?? null, address: billing?.company_address ?? null },
    taxLines: splitInvoiceGst(taxes, taxRate),
    amountInWords: numberToWordsINR(total),
    tableLines,
    stay: {
      checkIn: booking.check_in,
      checkOut: booking.check_out,
      nights: num(booking.nights),
      adults: num(booking.adults),
      children: num(booking.children),
      checkInTime: input.checkInTime,
      checkOutTime: input.checkOutTime,
    },
    roomLines,
    // Negotiated extras keep the same Standard → Discount → Net presentation.
    extraLines,
    chargeLines,
    totals: {
      itemsTotal,
      chargesTotal,
      subtotal: roundMoney(taxable + netDiscount),
      discount: netDiscount,
      taxable,
      taxRate,
      taxes,
      total,
      paid,
      balance,
      isCredit: balance < 0,
    },
    payments: payments.map((p) => ({ date: p.occurred_at, mode: p.payment_mode, amount: num(p.amount) })),
    paymentsTotal: payments.reduce((s, p) => s + num(p.amount), 0),
    footer:
      branding?.invoice_footer ||
      (isFinal
        ? "Thank you for staying with Hotel Excella. We hope to welcome you again."
        : "This is a Proforma Invoice. A final GST invoice will be issued after checkout."),
    signature: {
      url: branding?.signature_url ?? null,
      designation: branding?.signatory_designation || "Authorised Signatory",
    },
  };
}
