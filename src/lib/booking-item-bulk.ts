import { supabase } from "@/integrations/supabase/client";
import { listRooms, listOccupiedRoomIds } from "@/lib/rooms-api";
import { listAssignments, addAssignment, normalizeRoomType } from "@/lib/booking-room-assignments-api";
import {
  checkInBookingItem,
  checkOutBookingItem,
  moveBookingItemRoom,
} from "@/lib/booking-item-operations-api";

/**
 * ============================================================================
 * SHARED BULK OPERATIONS SERVICE (HEOS · Group Booking Productivity)
 * ============================================================================
 * Group bookings (20–30 rooms) are unworkable one row at a time. This service
 * fans a Reception intent out across selected Booking Items — but ONLY through
 * the existing shared per-item services, so every guarantee still holds:
 *
 *   • Occupancy Segments remain the single source of truth.
 *   • Shared Availability Engine decides which rooms are assignable.
 *   • Shared Checkout Validation gates every check-out.
 *   • Per-item activity timeline + housekeeping hooks fire per room.
 *
 * No bulk path writes to the database directly, and failures are per-item:
 * one rejected room never rolls back the rooms that succeeded.
 */

export interface BulkResult {
  succeeded: string[];
  failed: { itemId: string; label: string; error: string }[];
}

const emptyResult = (): BulkResult => ({ succeeded: [], failed: [] });

const labelOf = (item: any, index: number) =>
  (item?.primary_occupant_name ?? "").trim() || `Room ${index + 1}`;

async function runSequential(
  items: any[],
  fn: (item: any) => Promise<void>,
): Promise<BulkResult> {
  const res = emptyResult();
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    try {
      await fn(item);
      res.succeeded.push(item.id);
    } catch (e: any) {
      res.failed.push({
        itemId: item.id,
        label: labelOf(item, i),
        error: e?.message ?? "Operation failed",
      });
    }
  }
  return res;
}

/** Bulk Check-In — shared per-item check-in for each selected room. */
export function bulkCheckIn(items: any[]): Promise<BulkResult> {
  return runSequential(items, (it) => checkInBookingItem(it.id).then(() => undefined));
}

/** Bulk Check-Out — shared checkout validation applies per room. */
export function bulkCheckOut(
  items: any[],
  opts: { allowOverride?: boolean } = {},
): Promise<BulkResult> {
  return runSequential(items, (it) =>
    checkOutBookingItem(it.id, { allowOverride: opts.allowOverride }).then(() => undefined),
  );
}

/**
 * Picks free physical rooms for a booking window using the shared availability
 * engine, grouped by room type so each item lands in a room of its own type.
 */
async function availableRoomsByType(
  bookingId: string,
  check_in: string,
  check_out: string,
): Promise<Map<string, any[]>> {
  const [rooms, occupied, assignments] = await Promise.all([
    listRooms(true),
    listOccupiedRoomIds(check_in, check_out, bookingId),
    listAssignments(bookingId),
  ]);
  // Rooms already held by THIS booking's own segments are not re-offered.
  const held = new Set(
    assignments
      .filter((a: any) => a.start_date < check_out && check_in < a.end_date)
      .map((a: any) => a.room_id),
  );
  const byType = new Map<string, any[]>();
  for (const r of rooms as any[]) {
    if (occupied.has(r.id) || held.has(r.id)) continue;
    const key = normalizeRoomType(r.room_type);
    byType.set(key, [...(byType.get(key) ?? []), r]);
  }
  for (const [, list] of byType) {
    list.sort((a, b) => String(a.room_number).localeCompare(String(b.room_number), undefined, { numeric: true }));
  }
  return byType;
}

/**
 * Bulk Assign Rooms — assigns the first available room of each item's own room
 * type. Items that already hold a room are skipped by the caller.
 */
export async function bulkAssignRooms(input: {
  bookingId: string;
  items: any[];
  check_in: string;
  check_out: string;
}): Promise<BulkResult> {
  const pool = await availableRoomsByType(input.bookingId, input.check_in, input.check_out);
  const res = emptyResult();
  for (let i = 0; i < input.items.length; i++) {
    const item = input.items[i];
    const key = normalizeRoomType(item.room_type);
    const candidates = pool.get(key) ?? [];
    const room = candidates.shift();
    pool.set(key, candidates);
    if (!room) {
      res.failed.push({
        itemId: item.id,
        label: labelOf(item, i),
        error: `No available ${item.room_type} room for these dates`,
      });
      continue;
    }
    try {
      await addAssignment(input.bookingId, room.id, item.check_in ?? input.check_in, item.check_out ?? input.check_out, item.id);
      res.succeeded.push(item.id);
    } catch (e: any) {
      // Return the room to the pool so the next item can try it.
      pool.set(key, [room, ...(pool.get(key) ?? [])]);
      res.failed.push({ itemId: item.id, label: labelOf(item, i), error: e?.message ?? "Could not assign room" });
    }
  }
  return res;
}

/**
 * Bulk Room Move — moves each selected room to the next available room of the
 * same type via the canonical `moveBookingItemRoom` (segment split), so
 * historical occupancy is preserved for every moved room.
 */
export async function bulkMoveRooms(input: {
  bookingId: string;
  items: any[];
  check_in: string;
  check_out: string;
  effectiveDate?: string | null;
}): Promise<BulkResult> {
  const pool = await availableRoomsByType(input.bookingId, input.check_in, input.check_out);
  const res = emptyResult();
  for (let i = 0; i < input.items.length; i++) {
    const item = input.items[i];
    const key = normalizeRoomType(item.room_type);
    const candidates = pool.get(key) ?? [];
    const room = candidates.shift();
    pool.set(key, candidates);
    if (!room) {
      res.failed.push({
        itemId: item.id,
        label: labelOf(item, i),
        error: `No alternative ${item.room_type} room available`,
      });
      continue;
    }
    try {
      await moveBookingItemRoom({
        itemId: item.id,
        newRoomId: room.id,
        effectiveDate: input.effectiveDate ?? null,
      });
      res.succeeded.push(item.id);
    } catch (e: any) {
      pool.set(key, [room, ...(pool.get(key) ?? [])]);
      res.failed.push({ itemId: item.id, label: labelOf(item, i), error: e?.message ?? "Could not move room" });
    }
  }
  return res;
}

/** Convenience: current occupant/room snapshot for a booking (rooming list). */
export async function listRoomsForBooking(bookingId: string) {
  const { data } = await supabase
    .from("booking_room_assignments" as any)
    .select("id,item_id,room_id,start_date,end_date")
    .eq("booking_id", bookingId);
  return (data ?? []) as any[];
}
