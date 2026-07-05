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
import { supabase } from "@/integrations/supabase/client";
import { ensureContinueServiceTask } from "@/lib/hk-tasks";
import { setRoomHousekeepingStatus } from "@/lib/hk-status";
import { logActivity, newCorrelationId } from "@/lib/activity-log";

export async function generateContinueServiceTasks(businessDate: string): Promise<{
  created: number;
  skippedForException: number;
}> {
  // 1. Rooms currently occupied on `businessDate`.
  const { data: stays } = await supabase
    .from("bookings" as any)
    .select("id, room_id, check_in, check_out, status")
    .lte("check_in", businessDate)
    .gt("check_out", businessDate)
    .not("status", "in", "(Cancelled,No-Show,Draft,Checked-Out,Stay Completed)");
  const staysList = ((stays ?? []) as any[]).filter((b) => b.room_id);
  if (staysList.length === 0) return { created: 0, skippedForException: 0 };

  const roomIds = Array.from(new Set(staysList.map((s) => s.room_id))) as string[];

  // 2. Fetch rooms + exception rows in bulk.
  const [{ data: rooms }, { data: exceptions }] = await Promise.all([
    supabase.from("rooms" as any).select("id, housekeeping_status").in("id", roomIds),
    supabase.from("housekeeping_room_exceptions" as any)
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
