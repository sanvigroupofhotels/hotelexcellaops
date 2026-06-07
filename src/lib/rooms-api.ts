import { supabase } from "@/integrations/supabase/client";

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

/** Date overlap: [aIn, aOut) overlaps [bIn, bOut)  ↔  aIn < bOut && bIn < aOut */
export function datesOverlap(aIn: string, aOut: string, bIn: string, bOut: string) {
  return aIn < bOut && bIn < aOut;
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
 * Returns bookings already assigned to `room_id` whose dates overlap [check_in, check_out).
 * `excludeBookingId` skips the booking being edited.
 * Cancelled / Stay Completed / Checked-Out bookings are ignored.
 */
export async function findRoomConflicts(
  room_id: string,
  check_in: string,
  check_out: string,
  excludeBookingId?: string,
): Promise<RoomConflict[]> {
  const { data, error } = await supabase
    .from("bookings" as any)
    .select("id,booking_reference,guest_name,check_in,check_out,status")
    .eq("room_id", room_id)
    .not("status", "in", "(Cancelled,Stay Completed,Checked-Out)");
  if (error) throw error;
  const rows = (data ?? []) as any[];
  return rows
    .filter((b) => b.id !== excludeBookingId && datesOverlap(check_in, check_out, b.check_in, b.check_out))
    .map((b) => ({
      booking_id: b.id, booking_reference: b.booking_reference,
      guest_name: b.guest_name, check_in: b.check_in, check_out: b.check_out, status: b.status,
    }));
}
