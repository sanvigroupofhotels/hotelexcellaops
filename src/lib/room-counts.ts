/**
 * Single source of truth for room COUNTS and room-night KPIs across HEOS.
 *
 * Responsibility
 * ──────────────
 *   "How many rooms are occupied, sold, or consumed over a date or
 *    date range?"
 *
 * Consumers (must NOT re-implement this logic inline — no exceptions)
 * ───────────────────────────────────────────────────────────────────
 *   • Home Dashboard ("Occupied Rooms", Welcome strip, Today's Operations)
 *   • Owner Dashboard (ADR, RevPAR, Occupancy %, Room Nights Sold)
 *   • Analytics & Reporting (charts, trend reports)
 *   • Night Audit EOD snapshot
 *   • House View "Occupied" / forecast statistics
 *   • Forthcoming reports and widgets
 *
 * No future module may calculate occupied rooms, sold rooms, room nights or
 * occupancy independently — every surface routes through the three helpers
 * below. Never count `bookings.id`, never count `bookings.room_id`
 * directly. Multi-room bookings, unassigned bookings and split stays are
 * the common cases that get miscounted when each surface rolls its own
 * logic.
 *
 * Related helpers — keep responsibilities separate:
 *   • `room-inventory.ts`    → sellable capacity per ROOM TYPE (booking forms)
 *   • `room-availability.ts` → which PHYSICAL rooms are free (assignment)
 *   • `stay-segments.ts`     → physical room ↔ stay-slot pairing primitives
 *
 * Three operations cover every consumer:
 *
 *   countOccupiedRoomsOnDate()    — distinct PHYSICAL rooms occupied today
 *                                  (Welcome strip, Today's Operations,
 *                                  House View "Occupied", EOD snapshot)
 *
 *   sumCommittedRoomsOnDate()     — total committed rooms covering a date
 *                                  regardless of physical assignment
 *                                  (forecast widgets, "rooms sold today"
 *                                   before check-in)
 *
 *   sumCommittedRoomNights()      — committed room-nights overlapping a range
 *                                  (ADR / RevPAR / Owner Dashboard /
 *                                   Analytics)
 *
 * Statuses:
 *   ACTIVE_STATUSES        — included in occupancy counts (in-house today)
 *   COMMITTED_STATUSES     — counted as committed demand (sellable view)
 *   REVENUE_STATUSES       — counted for room-nights / revenue KPIs
 */
import {
  expandStaySlots,
  groupStayAssignments,
  groupStayItems,
  pairStaySlotsToRooms,
  segmentCoversDate,
  segmentOverlapsRange,
  slotEndExclusive,
  type StayAssignmentLike,
  type StayBookingLike,
  type StayItemLike,
  type StayRoomLike,
} from "@/lib/stay-segments";

/** Excluded from EVERY room count — these never consume capacity. */
const EXCLUDED_STATUSES = new Set(["Draft", "Cancelled", "No-Show"]);

/** Counts toward CURRENT physical occupancy (i.e. "in-house today"). */
const ACTIVE_STATUSES = new Set([
  "Pending",
  "Confirmed",
  "Advance Paid",
  "Full Paid",
  "Checked-In",
]);

/**
 * Counts toward committed demand (matches `room-inventory.ts`). Future-dated
 * arrivals are committed the moment a booking is created, regardless of
 * payment status.
 */
const COMMITTED_STATUSES = new Set([
  "Pending",
  "Confirmed",
  "Advance Paid",
  "Full Paid",
  "Checked-In",
]);

/** Counts toward Owner Dashboard / Analytics room-night & revenue KPIs. */
const REVENUE_STATUSES = new Set([
  "Pending",
  "Confirmed",
  "Advance Paid",
  "Full Paid",
  "Checked-In",
  "Checked-Out",
  "Stay Completed",
]);

export type StayLike = StayBookingLike & { status?: string | null };

export interface OccupiedRoomsResult {
  /** Distinct room_ids physically occupied on the date. */
  occupied: Set<string>;
  /** Bookings whose any slot covers the date and are still in-house. */
  inHouseBookings: StayLike[];
}

/**
 * PHYSICAL occupancy on a date.
 *
 * Counts every assigned room that physically covers `date` for stays in
 * an in-house status. Multi-room bookings count each assigned room.
 * Unassigned slots are intentionally NOT counted here — use
 * `sumCommittedRoomsOnDate()` if you need committed demand instead.
 */
export function countOccupiedRoomsOnDate(
  bookings: StayLike[],
  itemsByBooking: Map<string, StayItemLike[]>,
  assignmentsByBooking: Map<string, StayAssignmentLike[]>,
  rooms: StayRoomLike[],
  date: string,
): OccupiedRoomsResult {
  const occupied = new Set<string>();
  const inHouseBookings: StayLike[] = [];
  for (const b of bookings) {
    const status = String(b.status ?? "");
    if (EXCLUDED_STATUSES.has(status)) continue;
    if (!ACTIVE_STATUSES.has(status)) continue;
    const { paired, slots } = pairStaySlotsToRooms(b, itemsByBooking, assignmentsByBooking, rooms);
    if (!slots.some((slot) => segmentCoversDate(slot, date))) continue;
    inHouseBookings.push(b);
    for (const { room_id, slot } of paired) {
      if (segmentCoversDate(slot, date)) occupied.add(room_id);
    }
  }
  return { occupied, inHouseBookings };
}

/**
 * Committed-demand count on a date — sum of `booking_items.rooms` whose slot
 * covers the date and whose booking is in a committed status. Used for
 * forecast / Night Audit "rooms sold" before physical assignment exists.
 */
export function sumCommittedRoomsOnDate(
  bookings: StayLike[],
  itemsByBooking: Map<string, StayItemLike[]>,
  date: string,
): number {
  let total = 0;
  for (const b of bookings) {
    const status = String(b.status ?? "");
    if (!COMMITTED_STATUSES.has(status)) continue;
    const slots = expandStaySlots(b, itemsByBooking.get(b.id) ?? []);
    for (const slot of slots) {
      if (segmentCoversDate(slot, date)) total += 1;
    }
  }
  return total;
}

/**
 * Committed room-nights overlapping [rangeStart, rangeEnd] inclusive.
 *
 * One room-night = one room × one night. A 3-room booking for 2 nights
 * inside the range contributes 6 room-nights. Used by ADR / RevPAR /
 * Owner Dashboard / Analytics.
 *
 * Returns `{ totalRoomNights, byBooking }` so revenue can be pro-rated by
 * the same overlap fraction (per-booking room-nights ÷ booking's total
 * room-nights).
 */
export function sumCommittedRoomNights(
  bookings: StayLike[],
  itemsByBooking: Map<string, StayItemLike[]>,
  rangeStart: string,
  rangeEnd: string,
): { totalRoomNights: number; byBooking: Map<string, { inRange: number; total: number }> } {
  // Range is inclusive [start, end] → exclusive end = end + 1 day.
  const rangeEndExclusive = nextYmd(rangeEnd);
  let totalRoomNights = 0;
  const byBooking = new Map<string, { inRange: number; total: number }>();
  for (const b of bookings) {
    const status = String(b.status ?? "");
    if (!REVENUE_STATUSES.has(status)) continue;
    const slots = expandStaySlots(b, itemsByBooking.get(b.id) ?? []);
    let inRange = 0;
    let total = 0;
    for (const slot of slots) {
      const slotEnd = slotEndExclusive(slot);
      total += nightsBetweenYmd(slot.check_in, slotEnd);
      if (!segmentOverlapsRange(slot, rangeStart, rangeEndExclusive)) continue;
      inRange += overlapNightsYmd(slot.check_in, slotEnd, rangeStart, rangeEndExclusive);
    }
    if (inRange > 0 || total > 0) byBooking.set(b.id, { inRange, total });
    totalRoomNights += inRange;
  }
  return { totalRoomNights, byBooking };
}

// ---------------------------------------------------------------- date utils

function nextYmd(ymd: string): string {
  const d = new Date(ymd + "T00:00:00");
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function nightsBetweenYmd(checkIn: string, checkOutExclusive: string): number {
  const a = new Date(checkIn + "T00:00:00").getTime();
  const b = new Date(checkOutExclusive + "T00:00:00").getTime();
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

function overlapNightsYmd(
  checkIn: string,
  checkOutExclusive: string,
  rangeStart: string,
  rangeEndExclusive: string,
): number {
  const ms = 86_400_000;
  const ci = new Date(checkIn + "T00:00:00").getTime();
  const co = new Date(checkOutExclusive + "T00:00:00").getTime();
  const rs = new Date(rangeStart + "T00:00:00").getTime();
  const re = new Date(rangeEndExclusive + "T00:00:00").getTime();
  const start = Math.max(ci, rs);
  const end = Math.min(co, re);
  return Math.max(0, Math.round((end - start) / ms));
}

// ----------------------------------------------------------- re-export utils

/**
 * Convenience: build the (booking, items, assignments) maps in one call from
 * raw arrays. Pages that already use `groupStayItems` / `groupStayAssignments`
 * can keep doing so — this is just a shortcut for thin consumers.
 */
export function buildStayMaps(
  items: StayItemLike[],
  assignments: StayAssignmentLike[],
) {
  return {
    itemsByBooking: groupStayItems(items),
    assignmentsByBooking: groupStayAssignments(assignments),
  };
}
