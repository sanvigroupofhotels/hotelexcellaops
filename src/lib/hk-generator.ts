/**
 * Housekeeping — night-audit generator.
 *
 * Called by `closeSession()` immediately after the business date advances.
 * Creates a `continue_service` task for every room that is currently
 * occupied AND whose housekeeping_status is `ready`, unless the room has
 * an exception row for the new business date.
 *
 * Idempotent — safe to re-run (partial unique index guarantees at most one
 * open task per room/day/type).
 */
import { db } from "@/lib/db";
import { ensureContinueServiceTask } from "@/lib/hk-tasks";
import { setRoomHousekeepingStatus } from "@/lib/hk-status";
import { logActivity, newCorrelationId } from "@/lib/activity-log";

export async function generateContinueServiceTasks(businessDate: string): Promise<{
  created: number;
  skippedForException: number;
}> {
  // 1. Rooms genuinely occupied on `businessDate` — the guest was already
  //    staying overnight when the business date advanced. Same-day arrivals
  //    (check_in == businessDate) are FUTURE arrivals at generation time and
  //    must NOT receive continue-service tasks (design §2.3). Only stays that
  //    have actually been checked-in qualify — Pending / Confirmed arrivals
  //    that never checked in are not "occupied" rooms.
  //
  //    UAT-047: room occupancy comes from `booking_room_assignments` segments
  //    (start_date ≤ businessDate < end_date), NEVER from the legacy
  //    `bookings.room_id` column.
  const { data: stays } = await db()
    .from("bookings" as any)
    .select("id, check_in, check_out, status")
    .lt("check_in", businessDate)
    .gt("check_out", businessDate)
    .eq("status", "Checked-In");
  const bookingIds = ((stays ?? []) as any[]).map((b) => b.id as string);
  if (bookingIds.length === 0) return { created: 0, skippedForException: 0 };

  const { data: segments } = await db()
    .from("booking_room_assignments" as any)
    .select("booking_id, room_id, start_date, end_date")
    .in("booking_id", bookingIds)
    .lte("start_date", businessDate)
    .gt("end_date", businessDate);

  const staysList = ((segments ?? []) as any[])
    .filter((s) => s.room_id)
    .map((s) => ({ id: s.booking_id as string, room_id: s.room_id as string }));
  if (staysList.length === 0) return { created: 0, skippedForException: 0 };

  const roomIds = Array.from(new Set(staysList.map((s) => s.room_id))) as string[];


  // 2. Fetch rooms + exception rows in bulk.
  const [{ data: rooms }, { data: exceptions }] = await Promise.all([
    db().from("rooms" as any).select("id, housekeeping_status").in("id", roomIds),
    db().from("housekeeping_room_exceptions" as any)
      .select("room_id, reason").eq("business_date", businessDate).in("room_id", roomIds),
  ]);
  const roomStatus = new Map<string, string>();
  for (const r of (rooms ?? []) as any[]) roomStatus.set(r.id, r.housekeeping_status);
  const exceptionRooms = new Set<string>();
  for (const e of (exceptions ?? []) as any[]) exceptionRooms.add(e.room_id);

  const correlation_id = newCorrelationId();
  let created = 0;
  let skippedForException = 0;

  // 3. For each stay: if room is `ready` and no exception → create task and
  //    flip room to needs_service. Rooms in cleaning/servicing are left alone
  //    (see §7 edge #2). Rooms in `dirty` are already on today's checkout list.
  for (const s of staysList) {
    if (exceptionRooms.has(s.room_id)) {
      skippedForException += 1;
      continue;
    }
    const status = roomStatus.get(s.room_id);
    if (status !== "ready") continue;

    const task = await ensureContinueServiceTask({
      room_id: s.room_id,
      booking_id: s.id,
      business_date: businessDate,
    });
    if (task) {
      await setRoomHousekeepingStatus({
        roomId: s.room_id,
        next: "needs_service",
        reason: "Night audit generated service task",
        correlationId: correlation_id,
        activityAction: "hk_service_task_generated" as any,
        metadata: { task_id: task.id, business_date: businessDate },
      });
      created += 1;
    }
  }

  void logActivity({
    page: "Housekeeping",
    action: "hk_generator_ran" as any,
    entity_reference: businessDate,
    summary: `Continue-service generator · created ${created} · skipped ${skippedForException} exceptions`,
    metadata: { businessDate, created, skippedForException },
    source: "night_audit",
    correlation_id,
  });

  return { created, skippedForException };
}
