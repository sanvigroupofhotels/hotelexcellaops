import { supabase } from "@/integrations/supabase/client";
import { getBooking } from "@/lib/bookings-api";
import { listBookingItems, rowToLineItem, type BookingItemRow } from "@/lib/booking-items-api";
import { lineItemToPrimary, type SharedStayValue } from "@/components/shared/stay-form-sections";
import { toLocalYMD, localYMDOffset } from "@/lib/utils";
import type { LineItem } from "@/components/line-items-editor";

/**
 * ============================================================================
 * SHARED CLONE BOOKING SERVICE (HEOS)
 * ============================================================================
 * Reception repeats bookings for returning guests and groups constantly.
 * Cloning copies ONLY the commercial shape of a booking and deliberately drops
 * every operational / financial artefact so the clone behaves exactly like a
 * brand-new booking.
 *
 * COPIED
 *   Booking Holder · Contact details · Company / Corporate link (customer)
 *   Room Types · Number of Rooms · Adults / Children · Rate plan & nightly
 *   rates · Extras (breakfast, extra bed, early CI / late CO, pets, drivers)
 *   Special Requests · Booking (internal) Notes · Primary Occupants
 *
 * NEVER COPIED
 *   Payments · Charges · Guest Credit · Invoice · Booking Status ·
 *   Check-In / Check-Out state · Assigned Rooms · Occupancy Segments ·
 *   Housekeeping Tasks · Activity Timeline · Room Moves · Documents · Key Cards
 *
 * The clone is materialised through the ordinary new-booking flow, so the
 * shared pricing and availability engines are the ones that validate it —
 * this service only produces the prefill.
 */

export interface BookingClonePrefill {
  /** Customer link carries the company / corporate details forward. */
  customerId: string | null;
  /** Partial stay value to merge into the shared stay form. */
  stay: Partial<SharedStayValue>;
  /** Primary room line (already folded into `stay`) + additional rooms. */
  extras: LineItem[];
  /**
   * Primary occupant names in booking-item position order. Applied after the
   * clone is saved via {@link applyClonedOccupants}.
   */
  occupants: (string | null)[];
  /**
   * Negotiated nightly rate of the source primary room. Sticky: it overrides
   * the resolved rate so the commercial agreement survives the clone. The
   * shared pricing engine still recomputes every total from it.
   */
  rateOverride: number | null;
  /** Negotiated booking total override (and its tax-inclusive flag). */
  totalOverride: number | null;
  taxesIncluded: boolean;
  sourceReference: string;
}

/** Operational rooms that must not be carried into a clone. */
const isCloneable = (it: BookingItemRow) => it.item_status !== "Removed";

/** Default clone stay window — Today → Tomorrow. Pure, so it is unit-tested. */
export function cloneStayWindow(): { check_in: string; check_out: string } {
  return { check_in: toLocalYMD(), check_out: localYMDOffset(1) };
}

/**
 * Re-dates cloned room lines onto the default clone window. Commercial extras
 * (rates, extra beds, extra adults, pets, early CI / late CO, breakfast,
 * drivers) are preserved verbatim — only the dates move.
 */
export function normalizeClonedLines(
  lines: LineItem[],
  window = cloneStayWindow(),
): LineItem[] {
  return lines.map((l) => ({ ...l, check_in: window.check_in, check_out: window.check_out }));
}

export async function buildBookingClonePrefill(bookingId: string): Promise<BookingClonePrefill> {
  const [b, itemRows] = await Promise.all([getBooking(bookingId), listBookingItems(bookingId)]);
  if (!b) throw new Error("Source booking not found");

  const items = itemRows
    .filter(isCloneable)
    .sort((a, b2) => (a.position ?? 0) - (b2.position ?? 0));

  const window = cloneStayWindow();
  const lines = normalizeClonedLines(items.map(rowToLineItem), window);
  const occupants = items.map((it) => it.primary_occupant_name ?? null);

  const stay: Partial<SharedStayValue> = {
    guest_name: b.guest_name,
    phone: b.phone ?? "",
    email: b.email ?? "",
    lead_source: b.lead_source ?? "Direct",
    special_requests: b.notes ?? "",
    internal_notes: b.internal_notes ?? "",
    adults: b.adults,
    children: b.children,
    guests: b.guests,
    discount: Number(b.discount) || 0,
    ...(lines[0] ? lineItemToPrimary(lines[0]) : {}),
    // Clone defaults to a fresh Today → Tomorrow stay; Reception adjusts the
    // dates and the shared availability engine validates them on save.
    check_in: window.check_in,
    check_out: window.check_out,
  };

  return {
    customerId: b.customer_id ?? null,
    stay,
    extras: lines.slice(1),
    occupants,
    rateOverride: lines[0] ? Number(lines[0].rate) || null : null,
    totalOverride: b.total_override != null ? Number(b.total_override) : null,
    taxesIncluded: b.taxes_included ?? true,
    sourceReference: b.booking_reference,
  };
}


/**
 * Copies Primary Occupant names onto the freshly created booking's items,
 * matched by position. Purely descriptive metadata — no occupancy, no status.
 */
export async function applyClonedOccupants(
  bookingId: string,
  occupants: (string | null)[],
): Promise<void> {
  if (!occupants.some((o) => (o ?? "").trim())) return;
  const created = await listBookingItems(bookingId);
  const ordered = created.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  await Promise.all(
    ordered.map((it, i) => {
      const name = (occupants[i] ?? "").trim();
      if (!name) return Promise.resolve();
      return supabase
        .from("booking_items" as any)
        .update({ primary_occupant_name: name } as any)
        .eq("id", it.id)
        .then(() => undefined);
    }),
  );
}
