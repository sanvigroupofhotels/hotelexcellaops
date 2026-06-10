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
import { EARLY_CHECK_IN_SLOTS, LATE_CHECK_OUT_SLOTS, PET_RATES, EXTRA_ADULT_RATE, DRIVER_RATE } from "@/lib/mock-data";

export const DEFAULT_TAX_RATE = 0.05;

export interface PricingBreakdown {
  itemsTotal: number;
  discount: number;
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
  /** Itemized breakdown of additional charges (for detailed display). */
  additionalLineItems: { label: string; value: number }[];
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
function lineExtraItems(item: LineItem): { label: string; value: number }[] {
  const out: { label: string; value: number }[] = [];
  const n = nightsOf(item);
  const rooms = Math.max(1, item.rooms || 1);
  const rate = Number(item.rate) || 0;
  if (item.early_check_in && item.early_check_in_slot) {
    const s = EARLY_CHECK_IN_SLOTS.find((x) => x.value === item.early_check_in_slot);
    out.push({ label: `Early Check-In (${s?.label ?? item.early_check_in_slot})`, value: s?.fee ?? rate * rooms });
  }
  if (item.late_check_out && item.late_check_out_slot) {
    const s = LATE_CHECK_OUT_SLOTS.find((x) => x.value === item.late_check_out_slot);
    out.push({ label: `Late Check-Out (${s?.label ?? item.late_check_out_slot})`, value: s?.fee ?? rate * rooms });
  }
  const pet = PET_RATES[item.pet_size] ?? 0;
  if (pet > 0) out.push({ label: `Pet Stay (${item.pet_size}) · ${n}N`, value: pet * n });
  if ((item.extra_adults || 0) > 0) out.push({ label: `Extra Adults × ${item.extra_adults} · ${n}N`, value: (item.extra_adults || 0) * EXTRA_ADULT_RATE * n });
  if ((item.drivers || 0) > 0) out.push({ label: `Drivers × ${item.drivers} · ${n}N`, value: (item.drivers || 0) * DRIVER_RATE * n });
  return out;
}

export function computePricing(
  items: LineItem[],
  discount: number = 0,
  taxRate: number = DEFAULT_TAX_RATE,
  options: PricingOptions = {},
): PricingBreakdown {
  const itemsTotal = lineItemsTotal(items);
  let mainStayCharges = 0;
  const aggregated: Record<string, number> = {};
  for (const it of items) {
    mainStayCharges += lineRoomCharges(it);
    for (const x of lineExtraItems(it)) {
      aggregated[x.label] = (aggregated[x.label] || 0) + x.value;
    }
  }
  const additionalLineItems = Object.entries(aggregated).map(([label, value]) => ({ label, value }));
  const additionalStayCharges = additionalLineItems.reduce((s, x) => s + x.value, 0);

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
  let subtotal: number;
  let taxes: number;
  let total: number;

  if (taxesIncluded) {
    // base is gross — back out the tax component
    subtotal = Math.round(baseAfterDiscount / (1 + safeTaxRate));
    taxes = Math.max(0, baseAfterDiscount - subtotal);
    total = baseAfterDiscount;
  } else {
    subtotal = baseAfterDiscount;
    taxes = Math.round(baseAfterDiscount * safeTaxRate);
    total = baseAfterDiscount + taxes;
  }

  return {
    itemsTotal: effectiveItemsTotal,
    discount: effectiveDiscount,
    subtotal,
    taxRate: safeTaxRate,
    taxes,
    total,
    mainStayCharges: effectiveMainStay,
    additionalStayCharges,
    additionalLineItems,
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
