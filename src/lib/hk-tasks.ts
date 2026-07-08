/**
 * Housekeeping Task engine — the operational fanout.
 *
 * Public API:
 *   - listOpenTasks(businessDate)
 *   - startTask(taskId, actor)
 *   - completeTask(taskId, payload)   — full side-effect fanout
 *   - skipTask(taskId, reason, actor) — for "Service Not Required" / DND
 *   - ensureCheckoutTask(...)         — used by checkout hook
 *   - ensureContinueServiceTask(...)  — used by night-audit generator
 *
 * `completeTask` is the ONLY place that reads/writes the operational
 * side-effects: consumables → `recordMovement`, linen → `laundry_queue`,
 * issues → `complaints` (non-blocking), then flips the room state through
 * `hk-status`. Every side-effect shares one `correlation_id`.
 *
 * Design refs: §4 helpers, §4.2 fanout, §7 edge cases.
 */
import { supabase } from "@/integrations/supabase/client";
import { logActivity, newCorrelationId } from "@/lib/activity-log";
import { recordMovement } from "@/lib/inventory-movements";
import { setRoomHousekeepingStatus, type HousekeepingStatus } from "@/lib/hk-status";
import { enqueueLinen } from "@/lib/laundry-queue-api";
import { createComplaint } from "@/lib/complaints-api";

export type HkTaskType = "checkout_clean" | "continue_service";
export type HkTaskState = "open" | "in_progress" | "done" | "skipped";
export type HkSkipReason = "not_required" | "dnd" | "superseded_by_checkout";
export type HkTaskOrigin = "auto_checkout" | "auto_night_audit" | "manual";

export interface HkTaskRow {
  id: string;
  room_id: string;
  booking_id: string | null;
  business_date: string;
  type: HkTaskType;
  state: HkTaskState;
  origin: HkTaskOrigin;
  manual_reason: string | null;
  started_at: string | null;
  finished_at: string | null;
  performed_by_user_id: string | null;
  performed_by_name: string | null;
  recorded_by_user_id: string | null;
  recorded_by_name: string | null;
  skipped_reason: string | null;
  remarks: string | null;
  consumables_snapshot: any;
  linen_snapshot: any;
  issues_snapshot: any;
  correlation_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ConsumableLine { inventory_item_id: string; name_at_time: string; qty: number; }
export interface LinenLine       { linen_type_id: string; name_at_time: string; qty: number; }
export interface IssueLine       { issue_type_id: string; label_at_time: string; note?: string | null; default_complaint_category_id?: string | null; }

export interface CompleteTaskPayload {
  consumables: ConsumableLine[];
  linen: LinenLine[];
  issues: IssueLine[];
  remarks?: string | null;
  performer: { id: string; name: string };
  recorder:  { id: string; name: string };
}

/* ------------------------------------------------------------ */
/* Reads                                                        */
/* ------------------------------------------------------------ */

export async function listTasksForDate(businessDate: string): Promise<HkTaskRow[]> {
  const { data, error } = await supabase
    .from("housekeeping_tasks" as any)
    .select("*")
    .eq("business_date", businessDate)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as HkTaskRow[];
}

export async function getTask(id: string): Promise<HkTaskRow | null> {
  const { data, error } = await supabase
    .from("housekeeping_tasks" as any)
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data as any) ?? null;
}

/* ------------------------------------------------------------ */
/* Task creation (idempotent — partial unique index enforces it)*/
/* ------------------------------------------------------------ */

export async function ensureCheckoutTask(input: {
  room_id: string;
  booking_id: string | null;
  business_date: string;
  correlation_id?: string | null;
}): Promise<HkTaskRow | null> {
  // Already have an open/in_progress checkout task for this room/day?
  const { data: existing } = await supabase
    .from("housekeeping_tasks" as any)
    .select("*")
    .eq("room_id", input.room_id)
    .eq("business_date", input.business_date)
    .eq("type", "checkout_clean")
    .in("state", ["open", "in_progress"])
    .maybeSingle();
  if (existing) return existing as unknown as HkTaskRow;

  const { data, error } = await supabase
    .from("housekeeping_tasks" as any)
    .insert({
      room_id: input.room_id,
      booking_id: input.booking_id,
      business_date: input.business_date,
      type: "checkout_clean",
      state: "open",
      origin: "auto_checkout",
      correlation_id: input.correlation_id ?? null,
    } as any)
    .select()
    .single();
  if (error) {
    // Unique-violation race → fetch what's there.
    if ((error as any).code === "23505") {
      const { data: r } = await supabase.from("housekeeping_tasks" as any)
        .select("*")
        .eq("room_id", input.room_id).eq("business_date", input.business_date)
        .eq("type", "checkout_clean").in("state", ["open", "in_progress"]).maybeSingle();
      return (r as any) ?? null;
    }
    throw error;
  }
  return data as unknown as HkTaskRow;
}

export async function ensureContinueServiceTask(input: {
  room_id: string;
  booking_id: string | null;
  business_date: string;
}): Promise<HkTaskRow | null> {
  const { data: existing } = await supabase
    .from("housekeeping_tasks" as any)
    .select("*")
    .eq("room_id", input.room_id)
    .eq("business_date", input.business_date)
    .eq("type", "continue_service")
    .in("state", ["open", "in_progress"])
    .maybeSingle();
  if (existing) return existing as unknown as HkTaskRow;

  const { data, error } = await supabase
    .from("housekeeping_tasks" as any)
    .insert({
      room_id: input.room_id,
      booking_id: input.booking_id,
      business_date: input.business_date,
      type: "continue_service",
      state: "open",
    } as any)
    .select()
    .single();
  if (error) {
    if ((error as any).code === "23505") return null;
    throw error;
  }
  return data as unknown as HkTaskRow;
}

/* ------------------------------------------------------------ */
/* Transitions                                                  */
/* ------------------------------------------------------------ */

export async function startTask(taskId: string, actor: { id: string; name: string }): Promise<void> {
  // Optimistic lock: only transition from open → in_progress; a second caller
  // gets zero rows updated and knows another user got there first.
  const { data: rows, error } = await supabase
    .from("housekeeping_tasks" as any)
    .update({
      state: "in_progress",
      started_at: new Date().toISOString(),
      performed_by_user_id: actor.id,
      performed_by_name: actor.name,
    } as any)
    .eq("id", taskId)
    .eq("state", "open")
    .select("id, room_id, type");
  if (error) throw error;
  if (!rows || (rows as any[]).length === 0) {
    throw new Error("Task is already started or completed. Refresh to see the latest state.");
  }
  const row = (rows as any[])[0];
  await setRoomHousekeepingStatus({
    roomId: row.room_id,
    next: row.type === "checkout_clean" ? "cleaning" : "servicing",
    reason: row.type === "checkout_clean" ? "Cleaning started" : "Service started",
    actorId: actor.id,
    actorName: actor.name,
    activityAction: "hk_task_started" as any,
    metadata: { task_id: taskId, task_type: row.type },
  });
}

export async function completeTask(taskId: string, payload: CompleteTaskPayload): Promise<void> {
  const task = await getTask(taskId);
  if (!task) throw new Error("Task not found");
  if (task.state === "done") throw new Error("Task is already completed");
  if (task.state === "skipped") throw new Error("Task is skipped and can't be completed");

  const correlation_id = task.correlation_id ?? newCorrelationId();

  // Snapshot inputs (design C13) — never lose the exact selection.
  const consumablesSnapshot = payload.consumables.filter((c) => c.qty > 0);
  const linenSnapshot       = payload.linen.filter((l) => l.qty > 0);
  const issuesSnapshot      = payload.issues.map((i) => ({
    issue_type_id: i.issue_type_id,
    label_at_time: i.label_at_time,
    note: (i.note ?? "").trim() || null,
    default_complaint_category_id: i.default_complaint_category_id ?? null,
  }));

  // ── 1. Optimistic lock: flip state to done in a single UPDATE.
  const now = new Date().toISOString();
  const { data: doneRows, error: doneErr } = await supabase
    .from("housekeeping_tasks" as any)
    .update({
      state: "done",
      finished_at: now,
      started_at: task.started_at ?? now,
      performed_by_user_id: payload.performer.id,
      performed_by_name: payload.performer.name,
      recorded_by_user_id: payload.recorder.id,
      recorded_by_name: payload.recorder.name,
      remarks: (payload.remarks ?? "").trim() || null,
      consumables_snapshot: consumablesSnapshot,
      linen_snapshot: linenSnapshot,
      issues_snapshot: issuesSnapshot,
      correlation_id,
    } as any)
    .eq("id", taskId)
    .in("state", ["open", "in_progress"])
    .select("id");
  if (doneErr) throw doneErr;
  if (!doneRows || (doneRows as any[]).length === 0) {
    throw new Error(`Already completed by ${task.performed_by_name ?? "another user"}.`);
  }

  // ── 2. Inventory: one recordMovement per consumable line.
  for (const c of consumablesSnapshot) {
    try {
      await recordMovement({
        item_id: c.inventory_item_id,
        delta: -Math.abs(c.qty),
        reason: "auto_housekeeping",
        source_type: "hk_task",
        source_id: taskId,
        notes: `Housekeeping · ${task.type} · ${c.name_at_time}`,
        correlation_id,
      });
    } catch (e: any) {
      // Inventory failures don't unwind the task — the movement engine already
      // allows negative stock; if it truly failed, log for reconciliation.
      void logActivity({
        page: "Housekeeping",
        action: "hk_inventory_movement_failed" as any,
        entity_type: "hk_task",
        entity_id: taskId,
        summary: `Inventory movement failed: ${c.name_at_time} (${e?.message ?? e})`,
        source: "manual",
        correlation_id,
      });
    }
  }

  // ── 3. Linen → laundry_queue.
  if (linenSnapshot.length > 0) {
    try {
      await enqueueLinen(linenSnapshot.map((l) => ({
        room_id: task.room_id,
        booking_id: task.booking_id,
        linen_type_id: l.linen_type_id,
        linen_name_at_time: l.name_at_time,
        qty: l.qty,
        source_task_id: taskId,
        business_date: task.business_date,
        actor_id: payload.performer.id,
        actor_name: payload.performer.name,
      })));
    } catch (e: any) {
      void logActivity({
        page: "Housekeeping",
        action: "hk_laundry_enqueue_failed" as any,
        entity_type: "hk_task",
        entity_id: taskId,
        summary: `Laundry queue failed (${e?.message ?? e})`,
        source: "manual",
        correlation_id,
      });
    }
  }

  // ── 4. Flip room housekeeping status → ready.
  await setRoomHousekeepingStatus({
    roomId: task.room_id,
    next: "ready",
    reason: task.type === "checkout_clean" ? "Cleaning finished" : "Service finished",
    correlationId: correlation_id,
    actorId: payload.performer.id,
    actorName: payload.performer.name,
    activityAction: "hk_task_completed" as any,
    metadata: { task_id: taskId, task_type: task.type },
  });

  // ── 5. Issues → complaints (best-effort, C9).
  await filePotentialComplaints({
    task,
    issues: issuesSnapshot,
    recorder: payload.recorder,
    correlation_id,
  });
}

async function filePotentialComplaints(input: {
  task: HkTaskRow;
  issues: Array<{ issue_type_id: string; label_at_time: string; note: string | null; default_complaint_category_id: string | null }>;
  recorder: { id: string; name: string };
  correlation_id: string;
}) {
  if (input.issues.length === 0) return;

  // Fallback category — the design mandates the seeded "Housekeeping Report".
  let fallbackCategory = "Housekeeping Report";
  try {
    const { data: cat } = await supabase.from("complaint_categories" as any)
      .select("name").ilike("name", "housekeeping report").eq("active", true).maybeSingle();
    if (cat && (cat as any).name) fallbackCategory = (cat as any).name;
  } catch { /* keep default */ }

  const { data: room } = await supabase.from("rooms" as any)
    .select("room_number").eq("id", input.task.room_id).maybeSingle();
  const roomNumber = (room as any)?.room_number ?? null;

  for (const issue of input.issues) {
    let categoryName = fallbackCategory;
    if (issue.default_complaint_category_id) {
      try {
        const { data: cc } = await supabase.from("complaint_categories" as any)
          .select("name").eq("id", issue.default_complaint_category_id).maybeSingle();
        if (cc && (cc as any).name) categoryName = (cc as any).name;
      } catch { /* stick with fallback */ }
    }
    try {
      await createComplaint({
        complaint_type: "Room",
        room_number: roomNumber,
        booking_id: input.task.booking_id ?? null,
        category: categoryName,
        priority: "Medium",
        status: "Open",
        entered_by_staff_id: input.recorder.id,
        entered_by_name: input.recorder.name,
        description: `${issue.label_at_time}${issue.note ? " — " + issue.note : ""}`,
        issue_type: "Housekeeping",
      });
    } catch (e: any) {
      void logActivity({
        page: "Housekeeping",
        action: "hk_issue_complaint_failed" as any,
        entity_type: "hk_task",
        entity_id: input.task.id,
        summary: `Failed to file complaint for "${issue.label_at_time}": ${e?.message ?? e}`,
        metadata: { issue, error: String(e?.message ?? e) },
        source: "manual",
        correlation_id: input.correlation_id,
      });
    }
  }
}

export async function skipTask(taskId: string, reason: HkSkipReason, actor: { id: string; name: string }): Promise<void> {
  const { data: rows, error } = await supabase
    .from("housekeeping_tasks" as any)
    .update({
      state: "skipped",
      finished_at: new Date().toISOString(),
      skipped_reason: reason,
      recorded_by_user_id: actor.id,
      recorded_by_name: actor.name,
    } as any)
    .eq("id", taskId)
    .in("state", ["open", "in_progress"])
    .select("id, room_id, type");
  if (error) throw error;
  if (!rows || (rows as any[]).length === 0) return;   // already terminal — nothing to do
  const row = (rows as any[])[0];

  // Skipping a continue_service task via "not required" / "dnd" moves the room
  // straight to Ready for the day (design §2.3, §5.4).
  if (row.type === "continue_service" && (reason === "not_required" || reason === "dnd")) {
    let nextStatus: HousekeepingStatus = "ready";
    await setRoomHousekeepingStatus({
      roomId: row.room_id,
      next: nextStatus,
      reason: reason === "dnd" ? "Do Not Disturb" : "Service Not Required",
      actorId: actor.id,
      actorName: actor.name,
      activityAction: "hk_task_skipped" as any,
      metadata: { task_id: taskId, skipped_reason: reason },
    });
  }
}
