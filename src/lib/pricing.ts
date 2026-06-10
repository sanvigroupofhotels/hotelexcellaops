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
  const subtotal = Math.max(0, itemsTotal - safeDiscount);
  const safeTaxRate = Math.max(0, Number(taxRate) || 0);
  const taxes = Math.round(subtotal * safeTaxRate);
  const total = subtotal + taxes;
  return {
    itemsTotal, discount: safeDiscount, subtotal, taxRate: safeTaxRate, taxes, total,
    mainStayCharges, additionalStayCharges, additionalLineItems,
  };
}
// Re-export for callers
export { lineSubtotal };

export function balanceDue(total: number, paid: number) {
  return Math.max(0, Number(total || 0) - Number(paid || 0));
}

const inr = (n: number) => `₹${Math.round(Number(n) || 0).toLocaleString("en-IN")}`;
export const fmtINR = inr;
