/**
 * Room Occupancy — single source of truth.
 *
 * UAT-047: every module that renders or reports room occupancy history
 * (House View, Booking Detail, Housekeeping, Occupancy Reports, Owner
 * Dashboard, Room History, future modules) MUST derive segments from this
 * helper. `bookings.room_id` is only the current/effective room and must
 * never be used for historical rendering.
 */
import { supabase } from "@/integrations/supabase/client";

export interface RoomOccupancySegment {
  assignment_id: string;
  booking_id: string;
  room_id: string;
  /** inclusive YYYY-MM-DD */
  start_date: string;
  /** exclusive YYYY-MM-DD */
  end_date: string;
  ended_reason: string | null;
  created_at: string;
}

/**
 * Segments for one booking, or all bookings when `booking_id` is null.
 * Ordered by `booking_id, start_date, created_at`.
 */
export async function getRoomOccupancySegments(booking_id?: string | null): Promise<RoomOccupancySegment[]> {
  const { data, error } = await supabase.rpc("get_room_occupancy_segments" as any, {
    p_booking_id: booking_id ?? null,
  } as any);
  if (error) throw error;
  return (data ?? []) as unknown as RoomOccupancySegment[];
}

/** Returns the segment covering `date` for a booking, if any. */
export function segmentCoveringDate(
  segments: RoomOccupancySegment[],
  booking_id: string,
  date: string,
): RoomOccupancySegment | null {
  for (const s of segments) {
    if (s.booking_id !== booking_id) continue;
    if (s.start_date <= date && date < s.end_date) return s;
  }
  return null;
}

/** Room-nights in [rangeStart, rangeEnd) for a set of segments. */
export function roomNightsInRange(
  segments: RoomOccupancySegment[],
  rangeStart: string,
  rangeEnd: string,
): number {
  let nights = 0;
  for (const s of segments) {
    const a = s.start_date > rangeStart ? s.start_date : rangeStart;
    const b = s.end_date < rangeEnd ? s.end_date : rangeEnd;
    if (a < b) {
      nights += Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
    }
  }
  return nights;
}
