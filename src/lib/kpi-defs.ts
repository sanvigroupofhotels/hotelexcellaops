/**
 * Canonical KPI definitions for the Owner Dashboard and EOD report.
 * Single source of truth. ARR has been deprecated — do NOT reintroduce it.
 *
 * Standardized metrics:
 *   - ADR            = Room Revenue / Rooms Sold (room-nights)
 *   - RevPAR         = Room Revenue / Available Room-Nights
 *   - Room Revenue   = Σ proRated booking amount for room-nights in range
 *   - Total Revenue  = Room Revenue + In-house charges in range
 *   - Collections    = Σ booking_payments in range (refunds negative)
 *   - AOV            = Total Revenue / Distinct bookings (CRM only)
 */
export const ADR = (roomRevenue: number, roomsSold: number): number =>
  roomsSold > 0 ? roomRevenue / roomsSold : 0;

export const RevPAR = (roomRevenue: number, availableRoomNights: number): number =>
  availableRoomNights > 0 ? roomRevenue / availableRoomNights : 0;

export const OccupancyPct = (roomsSold: number, availableRoomNights: number): number =>
  availableRoomNights > 0 ? (roomsSold / availableRoomNights) * 100 : 0;

export const AOV = (totalRevenue: number, bookingCount: number): number =>
  bookingCount > 0 ? totalRevenue / bookingCount : 0;

/** Inclusive nights count between two YYYY-MM-DD ISO dates. */
export function nightsBetween(check_in: string, check_out: string): number {
  const a = new Date(check_in + "T00:00:00").getTime();
  const b = new Date(check_out + "T00:00:00").getTime();
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

/** Number of nights of a stay that fall inside [rangeStart, rangeEnd] inclusive. */
export function overlapNights(
  checkIn: string,
  checkOut: string,
  rangeStart: string,
  rangeEnd: string,
): number {
  // Stay covers nights [check_in, check_out). Range covers nights [rangeStart, rangeEnd + 1day).
  const ms = 86_400_000;
  const ci = new Date(checkIn + "T00:00:00").getTime();
  const co = new Date(checkOut + "T00:00:00").getTime();
  const rs = new Date(rangeStart + "T00:00:00").getTime();
  const re = new Date(rangeEnd + "T00:00:00").getTime() + ms; // exclusive
  const start = Math.max(ci, rs);
  const end = Math.min(co, re);
  return Math.max(0, Math.round((end - start) / ms));
}
