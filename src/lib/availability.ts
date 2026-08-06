/**
 * SHARED AVAILABILITY SERVICE — the single public entry point for every
 * "can we sell / assign this?" question in HEOS.
 *
 * One authoritative implementation, three query adapters. All three read the
 * same occupancy primitives in `src/lib/occupancy-source.ts` (segments +
 * maintenance blocks), so they can never disagree:
 *
 *   1. ROOM-TYPE capacity   → `getRoomTypeAvailability`  (booking forms,
 *                              booking engine, capacity widgets)
 *   2. PHYSICAL rooms free  → `listAvailableRoomsForStay` (assignment, check-in,
 *                              room move, housekeeping pickers)
 *   3. CONFLICT checks      → `findRoomConflicts`, `listOccupiedRoomIds`
 *                              (validation on save / extend / move)
 *
 * Rules for all feature code (routes, components, other services):
 *   • Import availability from THIS module, never from the adapters directly.
 *   • Never query `booking_room_assignments`, `room_maintenance`, or
 *     `bookings.room_id` inline to answer an availability question.
 *   • New granularities (e.g. Maintenance Module blocking) must be added here
 *     as another adapter over `occupancy-source`, not as a new query.
 */
export {
  CLOSED_OCCUPANCY_STATUSES,
  NON_COMMITTED_DEMAND_STATUSES,
  datesOverlap,
  listBusyRoomIds,
  listMaintenanceBlocks,
  listOccupancySegments,
  pgStatusList,
  type MaintenanceBlock,
  type OccupancySegment,
  type OccupancyWindow,
} from "@/lib/occupancy-source";

// 1 — room-type sellable capacity
export {
  getRoomTypeAvailability,
  maxSelectableRooms,
  useRoomTypeAvailability,
  type RoomTypeAvailability,
  type RoomTypeAvailabilityInput,
  type RoomTypeAvailabilityRow,
} from "@/lib/room-inventory";

// 2 — physical rooms assignable for a stay
export {
  listAvailableRoomsForStay,
  type AvailableRoomRow,
  type AvailableRoomsInput,
} from "@/lib/room-availability";

// 3 — conflict / occupancy checks
export { findRoomConflicts, listOccupiedRoomIds, type RoomConflict } from "@/lib/rooms-api";
