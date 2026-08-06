/**
 * Low-level OCCUPANCY SOURCE primitives — the only place in HEOS that reads
 * raw physical-occupancy rows out of the database.
 *
 * Everything availability-related sits on top of these three primitives:
 *
 *   listOccupancySegments()  → `booking_room_assignments` segments overlapping
 *                              a window, joined to their parent booking
 *   listMaintenanceBlocks()  → active `room_maintenance` blocks overlapping it
 *   listBusyRoomIds()        → union of the two, as a Set<room_id>
 *
 * Consumers must NOT query `booking_room_assignments` / `room_maintenance`
 * directly for availability. `bookings.room_id` is a retired compatibility
 * mirror and is never read here (UAT-047).
 *
 * Public entry point for feature code: `src/lib/availability.ts`.
 */
import { supabase } from "@/integrations/supabase/client";

/** Booking statuses that release physical occupancy. */
export const CLOSED_OCCUPANCY_STATUSES = [
  "Cancelled",
  "Stay Completed",
  "Checked-Out",
  "No-Show",
] as const;

/** Statuses that do NOT count as committed room-type demand (adds Draft). */
export const NON_COMMITTED_DEMAND_STATUSES = [
  "Draft",
  ...CLOSED_OCCUPANCY_STATUSES,
] as const;

/** Renders a status list for PostgREST `.not("col", "in", …)` filters. */
export function pgStatusList(statuses: readonly string[]): string {
  return `(${statuses.map((s) => `"${s}"`).join(",")})`;
}

/** Half-open date-range overlap: a.in < b.out AND b.in < a.out. */
export function datesOverlap(aIn: string, aOut: string, bIn: string, bOut: string) {
  return aIn < bOut && bIn < aOut;
}

export interface OccupancyWindow {
  check_in: string; // YYYY-MM-DD
  check_out: string; // YYYY-MM-DD
  exclude_booking_id?: string | null;
}

export interface OccupancySegment {
  room_id: string | null;
  booking_id: string;
  start_date: string;
  end_date: string;
  ended_reason: string | null;
  booking: {
    id: string;
    status: string;
    booking_reference?: string | null;
    guest_name?: string | null;
    check_in?: string | null;
    check_out?: string | null;
  };
}

/**
 * Occupancy segments overlapping [check_in, check_out) whose parent booking is
 * still operationally live. Overlap is a pure date check on the SEGMENT window
 * (UAT-052) — a segment closed by a mid-stay room change still blocks the dates
 * it actually covered, and frees every date after it.
 */
export async function listOccupancySegments(
  win: OccupancyWindow,
): Promise<OccupancySegment[]> {
  const { check_in, check_out, exclude_booking_id } = win;
  if (!check_in || !check_out || check_out < check_in) return [];
  const { data, error } = await supabase
    .from("booking_room_assignments" as any)
    .select(
      "room_id,booking_id,start_date,end_date,ended_reason,bookings:bookings!inner(id,status,booking_reference,guest_name,check_in,check_out)",
    )
    .lt("start_date", check_out)
    .gt("end_date", check_in)
    .not("bookings.status", "in", pgStatusList(CLOSED_OCCUPANCY_STATUSES));
  if (error) throw error;
  const out: OccupancySegment[] = [];
  for (const a of ((data ?? []) as any[])) {
    const b = a.bookings;
    if (!b) continue;
    if (exclude_booking_id && b.id === exclude_booking_id) continue;
    if (!datesOverlap(check_in, check_out, a.start_date, a.end_date)) continue;
    out.push({
      room_id: a.room_id ?? null,
      booking_id: a.booking_id,
      start_date: a.start_date,
      end_date: a.end_date,
      ended_reason: a.ended_reason ?? null,
      booking: b,
    });
  }
  return out;
}

export interface MaintenanceBlock {
  room_id: string | null;
  start_date: string;
  end_date: string;
  room_type?: string | null;
}

/** Active maintenance blocks overlapping [check_in, check_out). */
export async function listMaintenanceBlocks(
  win: Pick<OccupancyWindow, "check_in" | "check_out">,
): Promise<MaintenanceBlock[]> {
  const { check_in, check_out } = win;
  if (!check_in || !check_out || check_out < check_in) return [];
  const { data, error } = await supabase
    .from("room_maintenance" as any)
    .select("room_id, start_date, end_date, active, rooms!inner(room_type)")
    .eq("active", true)
    .lt("start_date", check_out)
    .gt("end_date", check_in);
  if (error) throw error;
  return ((data ?? []) as any[]).map((m) => ({
    room_id: m.room_id ?? null,
    start_date: m.start_date,
    end_date: m.end_date,
    room_type: m.rooms?.room_type ?? null,
  }));
}

/**
 * Every room_id that is unavailable for [check_in, check_out) — occupied by a
 * live segment OR under an active maintenance block.
 */
export async function listBusyRoomIds(win: OccupancyWindow): Promise<Set<string>> {
  const [segments, blocks] = await Promise.all([
    listOccupancySegments(win),
    listMaintenanceBlocks(win),
  ]);
  const busy = new Set<string>();
  for (const s of segments) if (s.room_id) busy.add(s.room_id);
  for (const m of blocks) if (m.room_id) busy.add(m.room_id);
  return busy;
}
