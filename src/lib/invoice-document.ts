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

export const INVOICE_HOTEL = {
  name: "HOTEL EXCELLA",
  tagline: "Boutique · Luxury · Stay",
  address: "Hotel Excella, Goa, India",
  phone: "+91 88594 44555",
  email: "stay@hotelexcella.in",
  website: "hotelexcella.in",
  gstin: "—",
} as const;

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
}

export interface InvoiceChargeLine {
  label: string;
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
  kind: "INVOICE" | "PROFORMA INVOICE";
  isFinal: boolean;
  /** Invoice number — booking reference based, stable per booking. */
  number: string;
  /** ISO date the document was issued. */
  issuedAt: string;
  hotel: typeof INVOICE_HOTEL;
  guest: { name: string; phone: string | null; email: string | null };
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
  branding?: { invoice_footer?: string | null; signature_url?: string | null; signatory_designation?: string | null } | null;
  checkInTime?: string;
  checkOutTime?: string;
  /** Optional map of booking_item id → room number label, for charge attribution. */
  roomLabels?: Record<string, string>;
  /** Override issue timestamp (tests). */
  now?: Date;
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
    const label =
      c.category === "Other" && c.other_description ? `${c.category} · ${c.other_description}` : c.category;
    return {
      label,
      room: it ? itemRoomLabel(it, roomLabels) : "",
      qty: num(c.quantity) || 1,
      amount: num(c.amount),
      itemId: c.item_id ?? null,
    };
  });
}

/**
 * Canonical invoice/proforma document model. Every number here comes from the
 * shared pricing engine so the document always matches Booking Detail.
 */
export function buildInvoiceDocument(input: BuildInvoiceInput): InvoiceDocModel {
  const { booking, items = [], payments = [], charges = [], branding, roomLabels } = input;
  const isFinal = (booking.status as string) === "Checked-Out";
  const discount = num((booking as any).discount);
  const taxRate = num((booking as any).tax_rate);

  let pricing: ReturnType<typeof computePricing> | null = null;
  if (items.length) {
    try {
      pricing = computePricing(items.map(rowToLineItem), discount, taxRate, {
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
  const taxable = (pricing?.subtotal ?? Math.max(0, bookingAmount - taxes)) + chargesTotal;


  const roomLines = buildRoomLines(items, roomLabels);
  // When there are no booking items (legacy bookings) fall back to a single
  // summary stay line so the document is never empty.
  if (!roomLines.length) {
    roomLines.push({
      label: booking.room_details || "Accommodation",
      qty: 1,
      nights: num(booking.nights) || 1,
      rate: itemsTotal,
      amount: itemsTotal,
      detail: "",
      itemIds: [],
    });
  }

  return {
    kind: isFinal ? "INVOICE" : "PROFORMA INVOICE",
    isFinal,
    number: isFinal ? `INV-${booking.booking_reference}` : `PI-${booking.booking_reference}`,
    issuedAt: (input.now ?? new Date()).toISOString(),
    hotel: INVOICE_HOTEL,
    guest: { name: booking.guest_name, phone: booking.phone ?? null, email: booking.email ?? null },
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
    extraLines: pricing?.additionalLineItems ?? [],
    chargeLines: buildChargeLines(charges, items, roomLabels),
    totals: {
      itemsTotal,
      chargesTotal,
      subtotal: itemsTotal + chargesTotal,
      discount,
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
