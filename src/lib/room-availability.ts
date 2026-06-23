import { supabase } from "@/integrations/supabase/client";

export interface AvailableRoomsInput {
  check_in: string; // YYYY-MM-DD
  check_out: string; // YYYY-MM-DD
  exclude_booking_id?: string | null;
  /** Optional: restrict to this category id */
  category_id?: string | null;
}

export interface AvailableRoomRow {
  id: string;
  room_number: string;
  category_id: string | null;
  category_name: string | null;
  floor: number | null;
}

/**
 * Returns rooms with NO overlapping booking, NO overlapping assignment,
 * and NO active maintenance block for [check_in, check_out).
 * Two stays overlap when: a.check_in < b.check_out AND b.check_in < a.check_out.
 */
export async function listAvailableRoomsForStay(input: AvailableRoomsInput): Promise<AvailableRoomRow[]> {
  const { check_in, check_out, exclude_booking_id, category_id } = input;
  if (!check_in || !check_out || check_in >= check_out) return [];

  // Fetch all active rooms (optionally filtered by category) in parallel with
  // the three sets of conflicts we need to subtract.
  const roomsQ = supabase
    .from("rooms")
    .select("id, room_number, category_id, floor, master_data!rooms_category_id_fkey(name)")
    .eq("active", true);
  if (category_id) roomsQ.eq("category_id", category_id);

  const closedStatuses = ["Cancelled", "Checked-Out", "Stay Completed", "No-Show"];

  const [{ data: rooms, error: rErr }, { data: bookings, error: bErr }, { data: assigns, error: aErr }, { data: blocks, error: mErr }] =
    await Promise.all([
      roomsQ,
      supabase
        .from("bookings")
        .select("id, room_id, check_in, check_out, status")
        .lt("check_in", check_out)
        .gt("check_out", check_in)
        .not("status", "in", `(${closedStatuses.map((s) => `"${s}"`).join(",")})`),
      supabase
        .from("booking_room_assignments" as any)
        .select("booking_id, room_id, bookings!inner(check_in,check_out,status)")
        .lt("bookings.check_in", check_out)
        .gt("bookings.check_out", check_in)
        .not("bookings.status", "in", `(${closedStatuses.map((s) => `"${s}"`).join(",")})`),
      supabase
        .from("room_maintenance" as any)
        .select("room_id, start_date, end_date, active")
        .eq("active", true)
        .lt("start_date", check_out)
        .gt("end_date", check_in),
    ]);

  if (rErr) throw rErr;
  if (bErr) throw bErr;
  if (aErr) throw aErr;
  if (mErr) throw mErr;

  const busy = new Set<string>();
  for (const b of (bookings ?? []) as any[]) {
    if (exclude_booking_id && b.id === exclude_booking_id) continue;
    if (b.room_id) busy.add(b.room_id);
  }
  for (const a of (assigns ?? []) as any[]) {
    if (exclude_booking_id && a.booking_id === exclude_booking_id) continue;
    if (a.room_id) busy.add(a.room_id);
  }
  for (const m of (blocks ?? []) as any[]) {
    if (m.room_id) busy.add(m.room_id);
  }

  return ((rooms ?? []) as any[])
    .filter((r) => !busy.has(r.id))
    .map((r) => ({
      id: r.id,
      room_number: r.room_number,
      category_id: r.category_id ?? null,
      category_name: (r as any).master_data?.name ?? null,
      floor: r.floor ?? null,
    }));
}
