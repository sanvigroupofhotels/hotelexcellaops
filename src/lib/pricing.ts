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
import { lineItemsTotal, type LineItem } from "@/components/line-items-editor";

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
}

export function computePricing(
  items: LineItem[],
  discount: number = 0,
  taxRate: number = DEFAULT_TAX_RATE,
): PricingBreakdown {
  const itemsTotal = lineItemsTotal(items);
  const safeDiscount = Math.max(0, Number(discount) || 0);
  const subtotal = Math.max(0, itemsTotal - safeDiscount);
  const safeTaxRate = Math.max(0, Number(taxRate) || 0);
  const taxes = Math.round(subtotal * safeTaxRate);
  const total = subtotal + taxes;
  return { itemsTotal, discount: safeDiscount, subtotal, taxRate: safeTaxRate, taxes, total };
}

export function balanceDue(total: number, paid: number) {
  return Math.max(0, Number(total || 0) - Number(paid || 0));
}

const inr = (n: number) => `₹${Math.round(Number(n) || 0).toLocaleString("en-IN")}`;
export const fmtINR = inr;
