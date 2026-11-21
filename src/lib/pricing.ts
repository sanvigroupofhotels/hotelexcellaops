/**
 * Shared pricing engine for Quotes, Bookings, Invoices, Booking Confirmations,
 * WhatsApp messages, and the future Guest Portal. Single source of truth.
 *
 * Pricing model (mirrors Quotes):
 *   Items Total       = sum of line item subtotals (room + extras)
 *   Discount          = user-entered discount (₹)
 *   Subtotal/Taxable  = Items Total − Discount      (cannot go below 0)
 *   Taxes             = round(Subtotal × tax_rate)  (default 5%)
 *   Total             = Subtotal + Taxes
 *
 * Override model:
 *   When `totalOverride` is provided, the staff-entered figure becomes the
 *   Final Booking Amount. `taxesIncluded` controls whether the override is
 *   treated as gross (taxes already in it) or net (tax-exclusive).
 *     - taxesIncluded=true  → subtotal = override / (1+rate); taxes = override - subtotal; total = override
 *     - taxesIncluded=false → subtotal = override;            taxes = round(override × rate); total = subtotal + taxes
 *   Discount, itemsTotal, mainStayCharges, additionalStayCharges remain the
 *   raw computed values so the UI can show the override badge cleanly.
 */
import { lineItemsTotal, lineSubtotal, nightsOf, type LineItem } from "@/components/line-items-editor";
import { normalizeLineGuests } from "@/lib/guest-allocation";
import { chargeFinancials } from "@/lib/expected-times";
import { EARLY_CHECK_IN_SLOTS, LATE_CHECK_OUT_SLOTS, PET_RATES, EXTRA_ADULT_RATE, DRIVER_RATE, extraAdultRateOf } from "@/lib/mock-data";

export const DEFAULT_TAX_RATE = 0.05;

export interface PricingBreakdown {
  itemsTotal: number;
  discount: number;
  discountPercent: number;
  /** Taxable amount = Items Total − Discount. Also called Subtotal. */
  subtotal: number;
  taxRate: number;
  taxes: number;
  /** Final amount payable = Subtotal + Taxes. */
  total: number;
  /** Just the room×nights portion of itemsTotal (Main Stay). */
  mainStayCharges: number;
  /** Extras portion (early/late/pet/extra adults/drivers) summed across all items. */
  additionalStayCharges: number;
  /**
   * Itemized breakdown of additional charges (for detailed display).
   * `standardValue` / `discount` are populated for Early Check-In / Late
   * Check-Out lines that Reception negotiated below the standard price, so
   * every surface can present Standard → Discount → Net.
   */
  additionalLineItems: { label: string; value: number; quantity: number; unit: string; standardValue?: number; discount?: number }[];
  /** Total negotiated discount on Early/Late services (already inside `value`s). */
  extrasDiscount: number;
  /** True when staff has manually overridden the Final Amount. */
  overrideApplied: boolean;
  /** True when override was entered as tax-inclusive (gross). */
  taxesIncluded: boolean;
}

export interface PricingOptions {
  /** Manual override of the Final Booking Amount. null/undefined = use computed. */
  totalOverride?: number | null;
  /** Whether `totalOverride` already includes taxes. Ignored when override is null. */
  taxesIncluded?: boolean;
}

/** Per-line room×nights subtotal, excluding all extras. */
function lineRoomCharges(item: LineItem): number {
  const n = nightsOf(item);
  const rooms = Math.max(1, item.rooms || 1);
  return (Number(item.rate) || 0) * n * rooms;
}

/** Per-line itemised extras (Early CI / Late CO / Pet / Extra Adults / Drivers). */
function lineExtraItems(item: LineItem): { key: string; label: string; quantity: number; unit: string; value: number; standardValue?: number; discount?: number }[] {
  const out: ReturnType<typeof lineExtraItems> = [];
  const n = nightsOf(item);
  const rooms = Math.max(1, item.rooms || 1);
  const rate = Number(item.rate) || 0;
  if (item.early_check_in && item.early_check_in_slot) {
    const s = EARLY_CHECK_IN_SLOTS.find((x) => x.value === item.early_check_in_slot);
    const standardUnit = s?.fee != null ? s.fee : rate;
    const fin = chargeFinancials(standardUnit, item.early_check_in_override ?? null);
    out.push({
      key: `early|${item.early_check_in_slot}`,
      label: `Early Check-In (${s?.label ?? item.early_check_in_slot})`, quantity: rooms, unit: "room",
      value: fin.final * rooms,
      standardValue: fin.standard * rooms,
      discount: fin.discount * rooms,
    });
  }
  if (item.late_check_out && item.late_check_out_slot) {
    const s = LATE_CHECK_OUT_SLOTS.find((x) => x.value === item.late_check_out_slot);
    const standardUnit = s?.fee != null ? s.fee : rate;
    const fin = chargeFinancials(standardUnit, item.late_check_out_override ?? null);
    out.push({
      key: `late|${item.late_check_out_slot}`,
      label: `Late Check-Out (${s?.label ?? item.late_check_out_slot})`, quantity: rooms, unit: "room",
      value: fin.final * rooms,
      standardValue: fin.standard * rooms,
      discount: fin.discount * rooms,
    });
  }
  const pet = PET_RATES[item.pet_size] ?? 0;
  if (pet > 0) out.push({ key: `pet|${item.pet_size}|${n}`, label: `Pet Stay (${item.pet_size}) · ${n}N`, quantity: 1, unit: "pet", value: pet * n });
  if ((item.extra_adults || 0) > 0) {
    const ear = extraAdultRateOf(item);
    out.push({ key: `adult|${n}|${ear}`, label: `Extra Adults · ${n}N${ear !== EXTRA_ADULT_RATE ? ` (@ ₹${ear}/n)` : ""}`, quantity: item.extra_adults, unit: "adult", value: (item.extra_adults || 0) * ear * n });
  }
  if ((item.drivers || 0) > 0) out.push({ key: `driver|${n}`, label: `Drivers · ${n}N`, quantity: item.drivers, unit: "driver", value: (item.drivers || 0) * DRIVER_RATE * n });
  return out;
}

/**
 * Canonical tax arithmetic for the whole platform.
 *
 * Every subtotal → taxes → total derivation in HEOS (bookings, quotes,
 * invoices, guest portal, public Booking Engine) MUST go through this function
 * so rounding behaviour is identical everywhere.
 *
 *   taxesIncluded = false → base is net:   taxes = round(base × rate); total = base + taxes
 *   taxesIncluded = true  → base is gross: subtotal = round(base / (1 + rate)); total = base
 */
export function applyTaxes(
  base: number,
  taxRate: number = DEFAULT_TAX_RATE,
  taxesIncluded = false,
): { subtotal: number; taxRate: number; taxes: number; total: number } {
  const safeBase = Math.max(0, Number(base) || 0);
  const safeTaxRate = Math.max(0, Number(taxRate) || 0);
  if (taxesIncluded) {
    const subtotal = Math.round(safeBase / (1 + safeTaxRate));
    return {
      subtotal,
      taxRate: safeTaxRate,
      taxes: Math.max(0, safeBase - subtotal),
      total: safeBase,
    };
  }
  const taxes = Math.round(safeBase * safeTaxRate);
  return { subtotal: safeBase, taxRate: safeTaxRate, taxes, total: safeBase + taxes };
}

export function computePricing(
  rawItems: LineItem[],
  discount: number = 0,
  taxRate: number = DEFAULT_TAX_RATE,
  options: PricingOptions = {},
): PricingBreakdown {
  // Occupancy-derived Extra Adults are applied here too, so a quote shown at
  // creation time equals what `booking_items` will persist (and what any later
  // recompute reads back). Manual surplus above the derived value is kept.
  const items = rawItems.map(normalizeLineGuests);
  const itemsTotal = lineItemsTotal(items);
  let mainStayCharges = 0;
  const aggregated = new Map<string, { label: string; quantity: number; unit: string; value: number; standardValue: number; discount: number }>();
  for (const it of items) {
    mainStayCharges += lineRoomCharges(it);
    for (const x of lineExtraItems(it)) {
      const cur = aggregated.get(x.key) ?? { label: x.label, quantity: 0, unit: x.unit, value: 0, standardValue: 0, discount: 0 };
      cur.quantity += x.quantity;
      cur.value += x.value;
      cur.standardValue += x.standardValue ?? x.value;
      cur.discount += x.discount ?? 0;
      aggregated.set(x.key, cur);
    }
  }
  const additionalLineItems = [...aggregated.values()].map((x) => {
    const suffix = x.unit === "room" ? ` × ${x.quantity} room${x.quantity === 1 ? "" : "s"}` : ` × ${x.quantity}`;
    return { label: x.label + suffix, value: x.value, quantity: x.quantity, unit: x.unit,
      ...(x.discount > 0 ? { standardValue: x.standardValue, discount: x.discount } : {}) };
  });
  const additionalStayCharges = additionalLineItems.reduce((s, x) => s + x.value, 0);
  const extrasDiscount = [...aggregated.values()].reduce((s, x) => s + x.discount, 0);

  const safeDiscount = Math.max(0, Number(discount) || 0);
  const safeTaxRate = Math.max(0, Number(taxRate) || 0);

  const overrideRaw = options.totalOverride;
  const hasOverride =
    overrideRaw !== null && overrideRaw !== undefined && Number.isFinite(Number(overrideRaw));
  const taxesIncluded = !!options.taxesIncluded;

  let effectiveItemsTotal = itemsTotal;
  let effectiveDiscount = safeDiscount;
  let effectiveMainStay = mainStayCharges;

  if (hasOverride) {
    const ov = Math.max(0, Number(overrideRaw));
    // The override is interpreted as the new "Room Charges" target:
    //   ov > computed itemsTotal → bump main stay so the new charge equals override
    //   ov < computed itemsTotal → derive an implicit discount; main stay stays as-is
    if (ov > itemsTotal) {
      effectiveItemsTotal = ov;
      effectiveMainStay = Math.max(0, ov - additionalStayCharges);
    } else if (ov < itemsTotal) {
      effectiveDiscount = Math.max(0, itemsTotal - ov);
    }
  }

  const baseAfterDiscount = Math.max(0, effectiveItemsTotal - effectiveDiscount);
  const { subtotal, taxes, total } = applyTaxes(baseAfterDiscount, safeTaxRate, taxesIncluded);

  return {
    itemsTotal: effectiveItemsTotal,
    discount: effectiveDiscount,
    discountPercent: discountPercentage(effectiveDiscount, effectiveItemsTotal),
    subtotal,
    taxRate: safeTaxRate,
    taxes,
    total,
    mainStayCharges: effectiveMainStay,
    additionalStayCharges,
    additionalLineItems,
    extrasDiscount,
    overrideApplied: hasOverride,
    taxesIncluded,
  };
}

// Re-export for callers
export { lineSubtotal };

export function balanceDue(total: number, paid: number) {
  return Math.max(0, Number(total || 0) - Number(paid || 0));
}

const inr = (n: number) => `₹${Math.round(Number(n) || 0).toLocaleString("en-IN")}`;
export const fmtINR = inr;

/** Display-only party wording; an unclassified legacy total stays labelled Guests. */
export function formatGuestParty(party: { adults?: number | null; children?: number | null; guests?: number | null }): string {
  const children = Math.max(0, Number(party.children) || 0);
  if (party.adults == null) {
    const guests = Math.max(0, Number(party.guests) || 0);
    return `${guests} Guest${guests === 1 ? "" : "s"}`;
  }
  const adults = Math.max(0, Number(party.adults) || 0);
  return `${adults} Adult${adults === 1 ? "" : "s"}${children > 0 ? ` · ${children} ${children === 1 ? "Child" : "Children"}` : ""}`;
}

/** Booking-wide guests summed across active room items; falls back to the header when no items exist. */
export function aggregateGuests(items: Array<{ adults?: number | null; children?: number | null; item_status?: string | null }>, fallback: { adults?: number | null; children?: number | null }) {
  const active = items.filter((i) => i.item_status !== "Removed" && i.item_status !== "Cancelled");
  const adults = active.length ? active.reduce((s, i) => s + (Number(i.adults) || 0), 0) : Number(fallback.adults) || 0;
  const children = active.length ? active.reduce((s, i) => s + (Number(i.children) || 0), 0) : Number(fallback.children) || 0;
  return { adults, children, guests: adults + children };
}

export function discountPercentage(discount: number, originalAmount: number): number {
  return originalAmount > 0 ? Math.round(Math.max(0, discount) / originalAmount * 1000) / 10 : 0;
}
