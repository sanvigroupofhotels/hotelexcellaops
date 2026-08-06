import { supabase } from "@/integrations/supabase/client";
import {
  datesOverlap,
  listOccupancySegments,
} from "@/lib/occupancy-source";

// Canonical overlap predicate lives in occupancy-source; re-exported for
// existing consumers so there is exactly one implementation.
export { datesOverlap };

export interface RoomRow {
  id: string;
  user_id: string;
  room_number: string;
  floor: number;
  room_type: string;
  active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface RoomMaintenanceRow {
  id: string;
  user_id: string;
  room_id: string;
  start_date: string;
  end_date: string;
  reason: string | null;
  created_at: string;
}

export async function listRooms(activeOnly = false) {
  let q = supabase.from("rooms" as any).select("*").order("floor").order("room_number");
  if (activeOnly) q = q.eq("active", true);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as unknown as RoomRow[];
}

export async function createRoom(input: { room_number: string; floor: number; room_type: string; active?: boolean }) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  const { data, error } = await supabase.from("rooms" as any).insert({ ...input, user_id: user.id } as any).select().single();
  if (error) throw error;
  return data as unknown as RoomRow;
}

export async function updateRoom(id: string, patch: Partial<Pick<RoomRow, "room_number" | "floor" | "room_type" | "active" | "notes">>) {
  const { error } = await supabase.from("rooms" as any).update(patch as any).eq("id", id);
  if (error) throw error;
}

export async function deleteRoom(id: string) {
  const { error } = await supabase.from("rooms" as any).delete().eq("id", id);
  if (error) throw error;
}

export async function listMaintenance() {
  const { data, error } = await supabase.from("room_maintenance" as any).select("*").order("start_date", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as RoomMaintenanceRow[];
}

export async function createMaintenance(input: { room_id: string; start_date: string; end_date: string; reason?: string }) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  const { error } = await supabase.from("room_maintenance" as any).insert({ ...input, user_id: user.id } as any);
  if (error) throw error;
}

export async function deleteMaintenance(id: string) {
  const { error } = await supabase.from("room_maintenance" as any).delete().eq("id", id);
  if (error) throw error;
}

export interface RoomConflict {
  booking_id: string;
  booking_reference: string;
  guest_name: string;
  check_in: string;
  check_out: string;
  status: string;
}

/**
 * Returns bookings already occupying `room_id` whose dates overlap [check_in, check_out).
 * `excludeBookingId` skips the booking being edited.
 * Cancelled / Stay Completed / Checked-Out / No-Show bookings are ignored.
 *
 * UAT-047 / production-hardening: occupancy comes from
 * `booking_room_assignments` SEGMENTS only. The legacy `bookings.room_id`
 * compatibility mirror is never read here — it cannot represent mid-stay room
 * changes and would report conflicts for rooms that were already vacated.
 */
export async function findRoomConflicts(
  room_id: string,
  check_in: string,
  check_out: string,
  excludeBookingId?: string,
): Promise<RoomConflict[]> {
  const segments = await listOccupancySegments({
    check_in,
    check_out,
    exclude_booking_id: excludeBookingId ?? null,
  });
  const seen = new Set<string>();
  const out: RoomConflict[] = [];
  for (const s of segments) {
    if (s.room_id !== room_id) continue;
    const b = s.booking;
    if (seen.has(b.id)) continue;
    seen.add(b.id);
    out.push({
      booking_id: b.id,
      booking_reference: b.booking_reference ?? "",
      guest_name: b.guest_name ?? "",
      check_in: b.check_in ?? "",
      check_out: b.check_out ?? "",
      status: b.status,
    });
  }
  return out;
}


/**
 * Returns the set of room_ids that have ANY non-cancelled booking overlapping
 * [check_in, check_out). Used by the booking form to fully HIDE occupied rooms
 * from the dropdown (UAT — for both staff and admins).
 */
export async function listOccupiedRoomIds(
  check_in: string,
  check_out: string,
  excludeBookingId?: string,
): Promise<Set<string>> {
  // UAT-047 / UAT-052: occupancy comes exclusively from segment windows via
  // the shared occupancy source. `bookings.room_id` is never read.
  const segments = await listOccupancySegments({
    check_in,
    check_out,
    exclude_booking_id: excludeBookingId ?? null,
  });
  const out = new Set<string>();
  for (const s of segments) if (s.room_id) out.add(s.room_id);
  return out;
}


