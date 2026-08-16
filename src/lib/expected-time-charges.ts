/**
 * Expected Arrival / Departure applier (browser).
 *
 * Persists the expected times on the booking and reconciles the Early
 * Check-In / Late Check-Out services through the shared plan produced by
 * `planExpectedTimeSync`. Every staff-side surface (Booking creation/edit,
 * Add Charge, House View, Booking Detail) goes through here; the Guest Portal
 * uses the server twin in `expected-time-charges.server.ts` with the same
 * pure planner, so there is exactly one set of rules.
 */
import { supabase } from "@/integrations/supabase/client";
import { listBookingItems } from "@/lib/booking-items-api";
import {
  listBookingCharges,
  createBookingCharge,
  updateBookingCharge,
  deleteBookingCharge,
} from "@/lib/booking-charges-api";
import {
  planExpectedTimeSync,
  type ExpectedTimeSyncPlan,
  type ExpectedTimeOverride,
} from "@/lib/expected-times";

export interface SyncExpectedTimesOptions {
  /** ISO timestamp or null to clear. `undefined` = leave the column untouched. */
  expectedArrivalAt?: string | null;
  expectedDepartureAt?: string | null;
  /** Restrict the service to these booking items (multi-room partial apply). */
  applyItemIds?: string[] | null;
  syncEarly?: boolean;
  syncLate?: boolean;
  /** Who posted the resulting charge(s). */
  addedBy?: string | null;
  /**
   * Reception-negotiated amounts per booking item + category. `unitPrice: null`
   * clears an override and restores automatic pricing. Overrides survive later
   * expected-time changes — only the standard/base amount is recalculated.
   */
  overrides?: ExpectedTimeOverride[];
}

/**
 * Persist expected times (when supplied) + reconcile charges idempotently.
 * Returns the applied plan so callers can surface what changed.
 */
export async function syncExpectedTimes(
  bookingId: string,
  opts: SyncExpectedTimesOptions = {},
): Promise<ExpectedTimeSyncPlan> {
  const patch: Record<string, unknown> = {};
  if (opts.expectedArrivalAt !== undefined) patch.expected_arrival_at = opts.expectedArrivalAt || null;
  if (opts.expectedDepartureAt !== undefined) patch.expected_departure_at = opts.expectedDepartureAt || null;
  if (Object.keys(patch).length > 0) {
    const { error } = await supabase.from("bookings" as any).update(patch as any).eq("id", bookingId);
    if (error) throw error;
  }

  const { data: b, error: bErr } = await supabase
    .from("bookings" as any)
    .select("expected_arrival_at, expected_departure_at")
    .eq("id", bookingId)
    .maybeSingle();
  if (bErr) throw bErr;

  const { hhmmFromISO } = await import("@/lib/expected-times");
  const [items, charges] = await Promise.all([
    listBookingItems(bookingId),
    listBookingCharges(bookingId),
  ]);

  const plan = planExpectedTimeSync({
    items: items as any,
    charges: charges as any,
    expectedArrival: hhmmFromISO((b as any)?.expected_arrival_at),
    expectedDeparture: hhmmFromISO((b as any)?.expected_departure_at),
    applyItemIds: opts.applyItemIds ?? null,
    syncEarly: opts.syncEarly,
    syncLate: opts.syncLate,
    overrides: opts.overrides ?? [],
  });

  for (const u of plan.itemUpdates) {
    const { error } = await supabase.from("booking_items" as any).update(u.patch as any).eq("id", u.id);
    if (error) throw error;
  }
  for (const c of plan.chargeCreates) {
    await createBookingCharge({
      booking_id: bookingId,
      item_id: c.item_id,
      category: c.category,
      quantity: c.quantity,
      unit_price: c.unit_price,
      standard_unit_price: c.standard_unit_price,
      price_overridden: c.price_overridden,
      notes: c.notes,
      added_by: opts.addedBy ?? null,
    });
  }
  for (const c of plan.chargeUpdates) {
    await updateBookingCharge(c.id, {
      quantity: c.quantity,
      unit_price: c.unit_price,
      standard_unit_price: c.standard_unit_price,
      price_overridden: c.price_overridden,
      notes: c.notes,
    });
  }
  for (const id of plan.chargeDeletes) await deleteBookingCharge(id);

  return plan;
}
