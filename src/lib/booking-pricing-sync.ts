/**
 * Booking pricing sync — v1.1 shared engine.
 *
 * Single choke-point for "recompute this booking's stored total from its
 * current items". Used by every stay-mutation entry point (House View
 * long-press / drag & drop / move dialog, Booking Detail popup, portal
 * extension, night-audit rollover) so the persisted `bookings.amount`,
 * `subtotal`, `taxes`, and `tax_rate` stay identical to what Edit Booking
 * would save.
 *
 * Pricing engine is `computePricing()` from `src/lib/pricing.ts` — no
 * parallel logic. Discount, override, and taxes-inclusive flag are all
 * read from the booking row itself so behaviour matches the Edit form.
 *
 * Non-blocking: failures are swallowed and logged; a stay mutation must
 * never fail because pricing sync errored.
 */
import { supabase } from "@/integrations/supabase/client";
import { listBookingItems, rowToLineItem } from "@/lib/booking-items-api";
import { computePricing, DEFAULT_TAX_RATE } from "@/lib/pricing";

export async function recomputeBookingAmount(bookingId: string): Promise<{
  amount: number;
  subtotal: number;
  taxes: number;
} | null> {
  try {
    const { data: b } = await supabase
      .from("bookings" as any)
      .select("id, discount, total_override, taxes_included, tax_rate")
      .eq("id", bookingId)
      .maybeSingle();
    if (!b) return null;

    const rows = await listBookingItems(bookingId);
    if (!rows || rows.length === 0) return null;

    const items = rows.map(rowToLineItem);
    const taxRate = Number((b as any).tax_rate ?? DEFAULT_TAX_RATE) || DEFAULT_TAX_RATE;
    const discount = Number((b as any).discount ?? 0) || 0;
    const totalOverride =
      (b as any).total_override == null ? null : Number((b as any).total_override);
    const taxesIncluded = !!(b as any).taxes_included;

    const p = computePricing(items, discount, taxRate, { totalOverride, taxesIncluded });

    const { error } = await supabase
      .from("bookings" as any)
      .update({
        amount: p.total,
        subtotal: p.subtotal,
        taxes: p.taxes,
        tax_rate: p.taxRate,
      } as any)
      .eq("id", bookingId);
    if (error) throw error;

    return { amount: p.total, subtotal: p.subtotal, taxes: p.taxes };
  } catch (e) {
    // Non-blocking. Log to console; upstream never sees this error.
    console.warn("recomputeBookingAmount failed", e);
    return null;
  }
}
