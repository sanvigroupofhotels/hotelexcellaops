/**
 * Pure, dependency-free booking-charge row builder.
 *
 * Kept in its own module (no Supabase client import) so BOTH the browser
 * service (`booking-charges-api.ts`) and server-only workflows
 * (`razorpay-completion.server.ts`) can share the exact same shaping and
 * validation without dragging a client into the server bundle.
 */
export interface BookingChargeInput {
  booking_id: string;
  item_id?: string | null;
  category: string;
  other_description?: string | null;
  quantity: number;
  unit_price: number;
  /** System-calculated price before any Reception override (audit trail). */
  standard_unit_price?: number | null;
  /** TRUE when Reception deliberately overrode the calculated amount. */
  price_overridden?: boolean | null;
  added_by?: string | null;
  occurred_at?: string;
  notes?: string | null;
}

/**
 * Canonical booking-charge row builder + validator.
 *
 * EVERY charge in HEOS is shaped here — the in-house charge dialog, per-room
 * fan-out, Past Due carry-forward, and the server-side Razorpay convenience-fee
 * split. Server contexts that must write with the service role call this and
 * insert the returned row; browser contexts use `createBookingCharge` below,
 * which is a thin wrapper over it. There is no other place that computes
 * `amount` or validates a charge.
 */
export function buildBookingChargeRow(
  input: BookingChargeInput,
  user_id: string,
): Record<string, unknown> {
  if (!input.booking_id) throw new Error("Booking is required");
  if (!input.category) throw new Error("Category is required");
  if (input.category === "Other" && !input.other_description?.trim())
    throw new Error("Description is required for 'Other'");
  if (!(input.quantity > 0)) throw new Error("Quantity must be greater than zero");
  if (input.unit_price < 0) throw new Error("Unit price cannot be negative");
  return {
    ...input,
    amount: Number((input.quantity * input.unit_price).toFixed(2)),
    user_id,
    occurred_at: input.occurred_at ?? new Date().toISOString(),
  };
}

