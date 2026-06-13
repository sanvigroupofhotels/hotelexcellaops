import { supabase } from "@/integrations/supabase/client";

export interface BookingRoomAssignmentRow {
  id: string;
  booking_id: string;
  room_id: string;
  user_id: string;
  created_at: string;
}

export async function listAssignments(booking_id: string) {
  const { data, error } = await supabase
    .from("booking_room_assignments" as any)
    .select("*")
    .eq("booking_id", booking_id)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as BookingRoomAssignmentRow[];
}

export async function addAssignment(booking_id: string, room_id: string) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  const { error } = await supabase.from("booking_room_assignments" as any)
    .insert({ booking_id, room_id, user_id: user.id } as any);
  if (error) throw error;
  // Keep legacy bookings.room_id in sync (use the first assignment).
  const list = await listAssignments(booking_id);
  await supabase.from("bookings" as any).update({ room_id: list[0]?.room_id ?? null } as any).eq("id", booking_id);
}

export async function removeAssignment(booking_id: string, assignment_id: string) {
  const { error } = await supabase.from("booking_room_assignments" as any).delete().eq("id", assignment_id);
  if (error) throw error;
  const list = await listAssignments(booking_id);
  await supabase.from("bookings" as any).update({ room_id: list[0]?.room_id ?? null } as any).eq("id", booking_id);
}

/** Required rooms = sum of booking_items.rooms; falls back to 1 when no items. */
export function requiredRoomCount(items: { rooms?: number | null }[]): number {
  if (!items || items.length === 0) return 1;
  const sum = items.reduce((acc, it) => acc + Math.max(1, Number(it.rooms ?? 1)), 0);
  return Math.max(1, sum);
}
