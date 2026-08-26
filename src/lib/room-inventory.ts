/**
 * Single source of truth for ROOM-TYPE sellable availability.
 *
 * Responsibility
 * ──────────────
 *   "How many rooms of each type (Oak / Mapple / …) are sellable for a given
 *    stay period [check_in, check_out)?"
 *
 * Demand counted as 'booked' is committed bookings (Pending, Confirmed,
 * Advance Paid, Full Paid, Checked-In) — independent of payment status and
 * independent of physical room assignment. Active maintenance blocks reduce
 * type capacity via `blocked`.
 *
 * Consumers (must NOT re-implement this logic inline)
 * ───────────────────────────────────────────────────
 *   • Full Booking Form (new + edit)
 *   • Quick Booking Form
 *   • Forthcoming Public Website Booking Engine
 *   • Forthcoming Channel / Partner APIs
 *   • Capacity widgets on House View / Calendar
 *
 * Related helpers — keep responsibilities separate:
 *   • `room-availability.ts` → which PHYSICAL rooms are free (assignment)
 *   • `room-counts.ts`       → occupied / sold / room-night COUNTS (KPIs)
 *
 * Returned shape per room type:
 *   total     — count of active rooms of that type
 *   booked    — committed-demand rooms overlapping the range
 *   blocked   — active maintenance blocks overlapping the range
 *   available — max(0, total - booked - blocked)
 *
 * Auto-refresh:
 *   The consuming React Query hook below uses dates + exclude_booking_id as
 *   its cache key, so the moment the user changes either date or any of the
 *   underlying tables (bookings, assignments, maintenance) is mutated and
 *   invalidated elsewhere in the app, the availability re-computes.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  NON_COMMITTED_DEMAND_STATUSES,
  listMaintenanceBlocks,
  pgStatusList,
} from "@/lib/occupancy-source";
import { buildRoomTypeAvailability, normalizeRoomTypeKey } from "@/lib/room-type-availability-core";


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

/**
 * Committed-demand model:
 *
 * A room is committed the moment a booking is created in a non-terminal,
 * non-draft status — payment status is irrelevant. We sum `booking_items.rooms`
 * grouped by normalized room_type across every overlapping committed booking,
 * then subtract from total inventory. Active maintenance blocks count against
 * the blocked room's specific type.
 *
 * Statuses counted as committed demand:
 *   Pending, Confirmed, Advance Paid, Full Paid, Checked-In
 * Statuses NOT counted (release inventory):
 *   Draft, Cancelled, Checked-Out, Stay Completed, No-Show
 *
 * This automatically reacts to: new bookings, cancellations, deletions,
 * room-count edits on items, and room-type changes — because all of those
 * mutate the same `booking_items` / `bookings` rows this query reads.
 */
export async function getRoomTypeAvailability(
  input: RoomTypeAvailabilityInput,
): Promise<RoomTypeAvailability> {
  const { check_in, check_out, exclude_booking_id } = input;
  if (!check_in || !check_out || check_in >= check_out) return { byType: {} };

  const closedIn = pgStatusList(NON_COMMITTED_DEMAND_STATUSES);

  const [{ data: rooms, error: rErr }, { data: items, error: iErr }, blocks] =
    await Promise.all([
      supabase.from("rooms").select("id, room_type, active").eq("active", true),
      // Pull every booking_item belonging to a committed booking whose own
      // room-line dates overlap the requested window. Parent booking dates can
      // be wider than an individual room's stay, so filtering/counting by the
      // parent over-deducts inventory for staggered multi-room bookings.
      supabase
        .from("booking_items" as any)
        .select("booking_id, room_type, rooms, check_in, check_out, item_status, bookings!inner(id, status, draft_expires_at)")
        .lt("check_in", check_out)
        .gt("check_out", check_in)
        .not("bookings.status", "in", closedIn),
      // Maintenance blocks come from the shared occupancy source — one
      // implementation for every availability granularity.
      listMaintenanceBlocks({ check_in, check_out }),
    ]);
  if (rErr) throw rErr;
  if (iErr) throw iErr;

  return buildRoomTypeAvailability({
    check_in,
    check_out,
    rooms: (rooms ?? []) as any[],
    bookingItems: (items ?? []) as any[],
    maintenanceBlocks: blocks,
    exclude_booking_id,
  });
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
  // row.available already reflects true free capacity for the requested window
  // (when editing, `exclude_booking_id` removes the current booking's demand so
  // its own rooms are folded back into `available`). We therefore cap at
  // `row.available` and use `currentlySelected` only as a floor — it preserves
  // an existing selection if live inventory drops mid-edit, but never inflates
  // the cap beyond real availability. This prevents oversell on New Booking.
  const max = Math.max(currentlySelected, row.available);
  // Surface maintenance transparency: users see WHY inventory is reduced so a
  // legitimate block doesn't read as a phantom deduction (UAT-048).
  const blockedSuffix = row.blocked > 0 ? ` (${row.blocked} on maintenance)` : "";
  const label =
    row.available <= 0
      ? `${room_type} fully booked for these dates${blockedSuffix}`
      : `${row.available} of ${row.total} ${room_type}s available${blockedSuffix}`;
  return { max, available: row.available, total: row.total, label };
}
