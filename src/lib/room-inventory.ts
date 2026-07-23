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

  const closedStatuses = ["Draft", "Cancelled", "Checked-Out", "Stay Completed", "No-Show"];
  const closedIn = `(${closedStatuses.map((s) => `"${s}"`).join(",")})`;

  const [{ data: rooms, error: rErr }, { data: items, error: iErr }, { data: blocks, error: mErr }] =
    await Promise.all([
      supabase.from("rooms").select("id, room_type, active").eq("active", true),
      // Pull every booking_item belonging to a committed booking that overlaps
      // the requested window. We filter overlap on the parent booking's dates
      // via the inner join so per-item date overrides still resolve to the
      // owning booking's effective stay.
      supabase
        .from("booking_items" as any)
        .select("booking_id, room_type, rooms, bookings!inner(id, status, check_in, check_out)")
        .lt("bookings.check_in", check_out)
        .gt("bookings.check_out", check_in)
        .not("bookings.status", "in", closedIn),
      supabase
        .from("room_maintenance" as any)
        .select("room_id, start_date, end_date, active, rooms!inner(room_type)")
        .eq("active", true)
        .lt("start_date", check_out)
        .gt("end_date", check_in),
    ]);
  if (rErr) throw rErr;
  if (iErr) throw iErr;
  if (mErr) throw mErr;

  // Total inventory per canonical type key.
  const totalByKey: Record<string, { label: string; total: number }> = {};
  const activeRoomIds = new Set<string>();
  for (const r of (rooms ?? []) as any[]) {
    const label = r.room_type ?? "Other";
    const key = normalizeRoomTypeKey(label);
    if (!totalByKey[key]) totalByKey[key] = { label, total: 0 };
    totalByKey[key].total += 1;
    activeRoomIds.add(r.id);
  }

  // UAT-051: Booked demand must be computed per NIGHT, then peaked across
  // the requested range — not summed across the whole window. Two back-to-back
  // bookings (23→24 and 25→26) both overlap [23,26) but never share a night,
  // so summing them double-counts inventory and rejects a valid 23→26 stay.
  // Correct model:
  //   for each night N in [check_in, check_out):
  //     demand[N] = Σ rooms whose booking spans N (check_in ≤ N < check_out)
  //   booked = max over nights of demand[N]
  // This is exactly what the "single-night check" already returns, so
  // multi-night results now stay consistent with day-by-day availability.
  const nights: string[] = [];
  {
    const start = new Date(check_in + "T00:00:00Z");
    const end = new Date(check_out + "T00:00:00Z");
    for (let d = new Date(start); d < end; d.setUTCDate(d.getUTCDate() + 1)) {
      nights.push(d.toISOString().slice(0, 10));
    }
  }
  const addDay = (iso: string) => {
    const d = new Date(iso + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  };

  const demandByKeyNight: Record<string, Record<string, number>> = {};
  for (const it of (items ?? []) as any[]) {
    if (exclude_booking_id && it.booking_id === exclude_booking_id) continue;
    const key = normalizeRoomTypeKey(it.room_type ?? "");
    if (!key) continue;
    const n = Math.max(1, Number(it.rooms ?? 1) || 1);
    const bIn = it.bookings?.check_in as string | undefined;
    const bOut = it.bookings?.check_out as string | undefined;
    if (!bIn || !bOut) continue;
    // Day-use bookings (check_in === check_out) occupy that single night.
    const effOut = bIn === bOut ? addDay(bIn) : bOut;
    if (!demandByKeyNight[key]) demandByKeyNight[key] = {};
    for (const night of nights) {
      if (bIn <= night && night < effOut) {
        demandByKeyNight[key][night] = (demandByKeyNight[key][night] ?? 0) + n;
      }
    }
  }
  const bookedByKey: Record<string, number> = {};
  for (const [key, perNight] of Object.entries(demandByKeyNight)) {
    let peak = 0;
    for (const v of Object.values(perNight)) if (v > peak) peak = v;
    bookedByKey[key] = peak;
  }

  // Maintenance blocks count against the blocked room's specific type — but
  // ONLY if that room is still active inventory (UAT-048). Apply the same
  // per-night peak so overlapping-but-non-concurrent blocks don't stack.
  const blockDemandByKeyNight: Record<string, Record<string, number>> = {};
  for (const m of (blocks ?? []) as any[]) {
    if (m.room_id && !activeRoomIds.has(m.room_id)) continue;
    const label = m.rooms?.room_type ?? "";
    const key = normalizeRoomTypeKey(label);
    if (!key) continue;
    const mIn = m.start_date as string;
    const mOut = m.end_date as string;
    if (!mIn || !mOut) continue;
    if (!blockDemandByKeyNight[key]) blockDemandByKeyNight[key] = {};
    for (const night of nights) {
      if (mIn <= night && night < mOut) {
        blockDemandByKeyNight[key][night] = (blockDemandByKeyNight[key][night] ?? 0) + 1;
      }
    }
  }
  const blockedByKey: Record<string, number> = {};
  for (const [key, perNight] of Object.entries(blockDemandByKeyNight)) {
    let peak = 0;
    for (const v of Object.values(perNight)) if (v > peak) peak = v;
    blockedByKey[key] = peak;
  }


  const byType: Record<string, RoomTypeAvailabilityRow> = {};
  for (const [key, { label, total }] of Object.entries(totalByKey)) {
    const booked = bookedByKey[key] ?? 0;
    const blocked = blockedByKey[key] ?? 0;
    const available = Math.max(0, total - booked - blocked);
    byType[label] = { room_type: label, total, available, blocked, booked };
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
