/**
 * Single source of truth for room-type availability.
 *
 * Both the Full Booking Form and the (forthcoming) Quick Booking Form must
 * call this helper to derive how many Oak / Mapple rooms can still be sold
 * for a given date range. House View, calendar tiles, and any future capacity
 * widget should also go through here — never compute availability inline.
 *
 * Implementation reuses `listAvailableRoomsForStay()` (which already accounts
 * for overlapping bookings, room_room_assignments, and active maintenance
 * blocks) and groups the result by `room_type`. No new SQL is introduced.
 *
 * Returned shape per room type:
 *   total     — count of active rooms of that type
 *   booked    — total - available - blocked
 *   blocked   — active maintenance blocks overlapping the date range
 *   available — count of rooms with NO overlap for [check_in, check_out)
 *
 * Auto-refresh:
 *   The consuming React Query hook below uses dates + exclude_booking_id as
 *   its cache key, so the moment the user changes either date or any of the
 *   underlying tables (bookings, assignments, maintenance) is mutated and
 *   invalidated elsewhere in the app, the availability re-computes.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { listAvailableRoomsForStay } from "@/lib/room-availability";

export interface RoomTypeAvailabilityRow {
  room_type: string;
  total: number;
  booked: number;
  blocked: number;
  available: number;
}

export interface RoomTypeAvailability {
  /** Map keyed by room_type (e.g. "Oak Room", "Mapple Room"). */
  byType: Record<string, RoomTypeAvailabilityRow>;
}

export interface RoomTypeAvailabilityInput {
  check_in: string;
  check_out: string;
  /** Exclude the booking being edited from the "booked" count. */
  exclude_booking_id?: string | null;
}

export async function getRoomTypeAvailability(
  input: RoomTypeAvailabilityInput,
): Promise<RoomTypeAvailability> {
  const { check_in, check_out, exclude_booking_id } = input;
  if (!check_in || !check_out || check_in >= check_out) return { byType: {} };

  // Count active rooms per type — this is "total inventory".
  const { data: rooms, error } = await supabase
    .from("rooms")
    .select("id, room_type, active")
    .eq("active", true);
  if (error) throw error;

  const totalByType: Record<string, number> = {};
  for (const r of (rooms ?? []) as any[]) {
    const t = r.room_type ?? "Other";
    totalByType[t] = (totalByType[t] ?? 0) + 1;
  }

  // Available rooms for this exact stay — reuses the existing helper so
  // overlap / assignment / maintenance logic stays in ONE place.
  const available = await listAvailableRoomsForStay({
    check_in,
    check_out,
    exclude_booking_id: exclude_booking_id ?? null,
  });
  const availableByType: Record<string, number> = {};
  for (const r of available) {
    const t = r.room_type ?? "Other";
    availableByType[t] = (availableByType[t] ?? 0) + 1;
  }

  const byType: Record<string, RoomTypeAvailabilityRow> = {};
  for (const [room_type, total] of Object.entries(totalByType)) {
    const avail = availableByType[room_type] ?? 0;
    byType[room_type] = {
      room_type,
      total,
      available: avail,
      // We don't separately track blocked here — listAvailableRoomsForStay
      // already excludes blocked rooms from `available`, so they're folded
      // into (total - available). Booked is the dominant signal callers need.
      blocked: 0,
      booked: Math.max(0, total - avail),
    };
  }
  return { byType };
}

/**
 * React Query hook — use this from any form/widget that needs live availability.
 * Automatically re-fetches when dates change OR when any of the inputs
 * (bookings / booking_room_assignments / room_maintenance / rooms) are
 * invalidated elsewhere in the app via `useRealtimeInvalidate`.
 */
export function useRoomTypeAvailability(
  check_in: string,
  check_out: string,
  exclude_booking_id?: string | null,
) {
  return useQuery({
    queryKey: [
      "room-type-availability",
      check_in,
      check_out,
      exclude_booking_id ?? null,
    ],
    queryFn: () => getRoomTypeAvailability({ check_in, check_out, exclude_booking_id }),
    enabled: !!(check_in && check_out && check_in < check_out),
    staleTime: 30_000,
  });
}

/**
 * Helper for forms: given a chosen room_type and the user's intended room
 * count, return the maximum allowed value plus a friendly availability label.
 * The form is responsible for clamping its input.
 *
 * `currentlySelected` is the number of rooms already selected on THIS form
 * (so the user can keep their own selection — only foreign bookings reduce
 * the cap).
 */
/**
 * Normalize room_type labels so the Booking Form (which uses "Oak Room" /
 * "Mapple Room" from ROOM_TARIFFS) matches the canonical short labels stored
 * on `rooms.room_type` ("Oak" / "Mapple"). Trims a trailing " Room" suffix
 * and lowercases for comparison; never alters the on-screen label itself.
 */
function normalizeRoomTypeKey(label: string): string {
  return String(label || "").trim().replace(/\s+room$/i, "").toLowerCase();
}

export function maxSelectableRooms(
  availability: RoomTypeAvailability | undefined,
  room_type: string,
  currentlySelected = 0,
): { max: number; available: number; total: number; label: string } {
  if (!availability) {
    return { max: Math.max(1, currentlySelected), available: 0, total: 0, label: "Availability unknown" };
  }
  const want = normalizeRoomTypeKey(room_type);
  let row = availability.byType?.[room_type];
  if (!row) {
    for (const key of Object.keys(availability.byType ?? {})) {
      if (normalizeRoomTypeKey(key) === want) { row = availability.byType[key]; break; }
    }
  }
  if (!row) {
    return { max: Math.max(1, currentlySelected), available: 0, total: 0, label: `No ${room_type} inventory configured` };
  }
  const max = Math.max(currentlySelected, row.available + currentlySelected);
  const label =
    row.available <= 0
      ? `${room_type} fully booked for these dates`
      : `${row.available} of ${row.total} ${room_type}s available`;
  return { max, available: row.available, total: row.total, label };
}
