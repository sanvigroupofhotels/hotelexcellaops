/**
 * Booking pricing sync + post-mutation refresh — v1.1 shared engine.
 *
 * Single choke-point for "recompute this booking's stored total from its
 * current items" AND for "invalidate every UI cache that depends on this
 * booking". Used by every stay-mutation entry point (House View long-press
 * / drag & drop / move dialog, Booking Detail popup, portal extension,
 * night-audit rollover) so the persisted `bookings.amount`, `subtotal`,
 * `taxes`, and `tax_rate` stay identical to what Edit Booking would save
 * and every open surface refreshes without any user action.
 *
 * Pricing engine is `computePricing()` from `src/lib/pricing.ts` — no
 * parallel logic. Discount, override, and taxes-inclusive flag are all
 * read from the booking row itself so behaviour matches the Edit form.
 *
 * Non-blocking: failures are swallowed and logged; a stay mutation must
 * never fail because pricing sync errored.
 */
import type { QueryClient } from "@tanstack/react-query";
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

/**
 * Single choke-point for "a booking just changed — refresh every surface
 * that reads it" (UAT-008). Any caller that mutates a booking through a
 * non-standard path (House View long-press, drag & drop, popup Move, room
 * change, additional-room assign) MUST call this so the popup, House View
 * pills, Booking Detail, Edit Booking, and Dues all repaint immediately —
 * no extra Edit-Booking-Save required.
 *
 * Awaits pricing sync first so `bookings.amount` is already fresh before
 * caches invalidate; then fans out query invalidations. Non-blocking on
 * pricing failure (recomputeBookingAmount already swallows).
 */
export async function refreshAfterBookingMutation(
  qc: QueryClient,
  bookingId: string,
  opts: { skipPricing?: boolean } = {},
): Promise<void> {
  if (!opts.skipPricing) {
    await recomputeBookingAmount(bookingId);
  }
  // UAT-034: force-refetch the booking row BEFORE fanning out invalidations
  // so the Booking Summary / Balance Due / Advance Paid can NEVER read a
  // stale cache after a financial mutation. `advance_paid` is maintained by
  // the `booking_payments_recompute` DB trigger (subtracts refunds) and is
  // already committed by the time the mutation returned; we simply must
  // pull it into the cache before the UI reads it again.
  try {
    await qc.refetchQueries({ queryKey: ["booking", bookingId], type: "active" });
    await qc.refetchQueries({ queryKey: ["booking-payments", bookingId], type: "active" });
    await qc.refetchQueries({ queryKey: ["booking-charges", bookingId], type: "active" });
  } catch { /* refetch is best-effort; invalidation below is the safety net */ }

  const keys: (string | (string | undefined)[])[] = [
    ["booking", bookingId],
    ["booking-items", bookingId],
    ["booking-payments", bookingId],
    ["booking-charges", bookingId],
    ["booking-room-assignments", bookingId],
    "bookings",
    "booking-items-all",
    "booking-room-assignments-all",
    "all-charge-totals",
    "all-booking-payments",
    "house-view",
  ] as any;
  for (const k of keys) {
    try { qc.invalidateQueries({ queryKey: Array.isArray(k) ? k : [k] }); } catch { /* noop */ }
  }
}
