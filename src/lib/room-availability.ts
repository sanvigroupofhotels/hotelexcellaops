/**
 * Single source of truth for PHYSICAL room availability.
 *
 * Responsibility
 * ──────────────
 *   "Which specific physical rooms (by room_id) can be assigned for a given
 *    [check_in, check_out)?"
 *
 * Considers, in one round trip:
 *   • overlapping bookings (any room_id on the booking row)
 *   • overlapping `booking_room_assignments` (multi-room / split-stay)
 *   • active `room_maintenance` blocks
 *
 * Consumers (must NOT re-implement this logic inline)
 * ───────────────────────────────────────────────────
 *   • Room Assignment dialog
 *   • Check-In flow
 *   • Room Move dialog (House View + Booking Detail)
 *   • Housekeeping room picker
 *   • Forthcoming Desktop Drag & Drop on House View
 *
 * Related helpers — keep responsibilities separate:
 *   • `room-inventory.ts` → sellable capacity per ROOM TYPE (booking forms)
 *   • `room-counts.ts`    → occupied / sold / room-night COUNTS (KPIs)
 */
import { supabase } from "@/integrations/supabase/client";

export interface AvailableRoomsInput {
  check_in: string; // YYYY-MM-DD
  check_out: string; // YYYY-MM-DD
  exclude_booking_id?: string | null;
  /** Optional: restrict to this room_type / category */
  room_type?: string | null;
}

export interface AvailableRoomRow {
  id: string;
  room_number: string;
  room_type: string | null;
  floor: number | null;
}

/**
 * Returns rooms with NO overlapping booking, NO overlapping assignment,
 * and NO active maintenance block for [check_in, check_out).
 * Two stays overlap when: a.check_in < b.check_out AND b.check_in < a.check_out.
 */
export async function listAvailableRoomsForStay(input: AvailableRoomsInput): Promise<AvailableRoomRow[]> {
  const { check_in, check_out, exclude_booking_id, room_type } = input;
  if (!check_in || !check_out || check_in >= check_out) return [];

  const closedStatuses = ["Cancelled", "Checked-Out", "Stay Completed", "No-Show"];
  const closedIn = `(${closedStatuses.map((s) => `"${s}"`).join(",")})`;

  const roomsQ = supabase
    .from("rooms")
    .select("id, room_number, room_type, floor")
    .eq("active", true);
  if (room_type) roomsQ.eq("room_type", room_type);

  const [{ data: rooms, error: rErr }, { data: bookings, error: bErr }, { data: assigns, error: aErr }, { data: blocks, error: mErr }] =
    await Promise.all([
      roomsQ,
      supabase
        .from("bookings")
        .select("id, room_id, check_in, check_out, status")
        .lt("check_in", check_out)
        .gt("check_out", check_in)
        .not("status", "in", closedIn),
      supabase
        .from("booking_room_assignments" as any)
        .select("booking_id, room_id, start_date, end_date, bookings!inner(status)")
        .lt("start_date", check_out)
        .gt("end_date", check_in)
        .not("bookings.status", "in", closedIn),

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
      room_type: r.room_type ?? null,
      floor: r.floor ?? null,
    }));
}
