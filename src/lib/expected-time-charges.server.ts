/**
 * Expected Arrival / Departure applier (server, service-role).
 *
 * Server twin of `expected-time-charges.ts`. Both share the SAME pure planner
 * (`planExpectedTimeSync`) and the same canonical charge-row builder, so the
 * Guest Portal cannot drift from the staff-side behaviour or double-charge.
 */
import {
  planExpectedTimeSync,
  hhmmFromISO,
  type ExpectedTimeSyncPlan,
  type ExpectedTimeOverride,
} from "@/lib/expected-times";
import { buildBookingChargeRow } from "@/lib/booking-charge-row";

export async function syncExpectedTimesAdmin(
  db: any,
  bookingId: string,
  opts: {
    expectedArrivalAt?: string | null;
    expectedDepartureAt?: string | null;
    applyItemIds?: string[] | null;
    syncEarly?: boolean;
    syncLate?: boolean;
    addedBy?: string | null;
    /** Reception-negotiated amounts per item + category. */
    overrides?: ExpectedTimeOverride[];
  } = {},
): Promise<ExpectedTimeSyncPlan> {
  const patch: Record<string, unknown> = {};
  if (opts.expectedArrivalAt !== undefined) patch.expected_arrival_at = opts.expectedArrivalAt || null;
  if (opts.expectedDepartureAt !== undefined) patch.expected_departure_at = opts.expectedDepartureAt || null;
  if (Object.keys(patch).length > 0) {
    const { error } = await db.from("bookings").update(patch).eq("id", bookingId);
    if (error) throw error;
  }

  const { data: booking } = await db
    .from("bookings")
    .select("id, user_id, expected_arrival_at, expected_departure_at")
    .eq("id", bookingId)
    .maybeSingle();
  if (!booking) return {
    early: null, late: null, itemUpdates: [], chargeCreates: [], chargeUpdates: [], chargeDeletes: [],
    overrideWarnings: [],
  };

  const [{ data: items }, { data: charges }] = await Promise.all([
    db.from("booking_items").select("*").eq("booking_id", bookingId),
    db.from("booking_charges").select("*").eq("booking_id", bookingId),
  ]);

  const plan = planExpectedTimeSync({
    items: (items ?? []) as any,
    charges: (charges ?? []) as any,
    expectedArrival: hhmmFromISO(booking.expected_arrival_at),
    expectedDeparture: hhmmFromISO(booking.expected_departure_at),
    applyItemIds: opts.applyItemIds ?? null,
    syncEarly: opts.syncEarly,
    syncLate: opts.syncLate,
    overrides: opts.overrides ?? [],
  });

  for (const u of plan.itemUpdates) {
    const { error } = await db.from("booking_items").update(u.patch).eq("id", u.id);
    if (error) throw error;
  }
  for (const c of plan.chargeCreates) {
    const row = buildBookingChargeRow(
      {
        booking_id: bookingId,
        item_id: c.item_id,
        category: c.category,
        quantity: c.quantity,
        unit_price: c.unit_price,
        standard_unit_price: c.standard_unit_price,
        price_overridden: c.price_overridden,
        notes: c.notes,
        added_by: opts.addedBy ?? "Guest Portal",
      },
      booking.user_id,
    );
    const { error } = await db.from("booking_charges").insert(row);
    if (error) throw error;
  }
  for (const c of plan.chargeUpdates) {
    const { error } = await db
      .from("booking_charges")
      .update({
        quantity: c.quantity,
        unit_price: c.unit_price,
        standard_unit_price: c.standard_unit_price,
        price_overridden: c.price_overridden,
        amount: Number((c.quantity * c.unit_price).toFixed(2)),
        notes: c.notes,
      })
      .eq("id", c.id);
    if (error) throw error;
  }
  if (plan.chargeDeletes.length > 0) {
    const { error } = await db.from("booking_charges").delete().in("id", plan.chargeDeletes);
    if (error) throw error;
  }

  return plan;
}
