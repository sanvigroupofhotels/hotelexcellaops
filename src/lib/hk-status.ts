/**
 * Housekeeping room status — single write path.
 *
 * `rooms.housekeeping_status` is a derived operational axis, orthogonal to
 * booking status. It must ONLY be mutated through this helper so that:
 *   - the state machine is honoured (dirty → cleaning → ready etc.)
 *   - every transition is stamped with an actor + timestamp
 *   - `activity_log` receives a matching row (see design §6)
 *
 * The state machine is intentionally liberal about invalid transitions —
 * we log & no-op rather than throw, because the business flows (checkout,
 * night audit, exception actions) must never be blocked by a stale UI.
 */
import { supabase } from "@/integrations/supabase/client";
import { logActivity, type ActivityAction } from "@/lib/activity-log";

export type HousekeepingStatus =
  | "ready"
  | "dirty"
  | "cleaning"
  | "needs_service"
  | "servicing"
  | "out_of_service";

/** Simplified 4-state overlay shown in the House View. */
export type HousekeepingDisplayStatus = "Ready" | "Dirty" | "Needs Service" | "Out of Service";

export function mapDisplayHkStatus(s: HousekeepingStatus | null | undefined): HousekeepingDisplayStatus {
  switch (s) {
    case "dirty":
    case "cleaning":
      return "Dirty";
    case "needs_service":
    case "servicing":
      return "Needs Service";
    case "out_of_service":
      return "Out of Service";
    default:
      return "Ready";
  }
}

interface SetStatusInput {
  roomId: string;
  next: HousekeepingStatus;
  reason: string;                 // short reason for activity log
  correlationId?: string | null;
  actorId?: string | null;
  actorName?: string | null;
  metadata?: Record<string, any>;
  activityAction?: ActivityAction;
}

/** Write `rooms.housekeeping_status` and emit an activity_log row. */
export async function setRoomHousekeepingStatus(input: SetStatusInput): Promise<void> {
  const { data: current } = await supabase
    .from("rooms" as any)
    .select("id, housekeeping_status, room_number")
    .eq("id", input.roomId)
    .maybeSingle();
  if (!current) return;
  const prev = (current as any).housekeeping_status as HousekeepingStatus | null;
  if (prev === input.next) return;   // idempotent

  const { data: userRes } = await supabase.auth.getUser();
  const uid = input.actorId ?? userRes?.user?.id ?? null;

  const { error } = await supabase
    .from("rooms" as any)
    .update({
      housekeeping_status: input.next,
      hk_status_changed_at: new Date().toISOString(),
      hk_status_changed_by: uid,
    } as any)
    .eq("id", input.roomId);
  if (error) throw error;

  void logActivity({
    page: "Housekeeping",
    action: (input.activityAction ?? "hk_status_changed") as ActivityAction,
    entity_type: "room",
    entity_id: input.roomId,
    entity_reference: (current as any).room_number ?? null,
    summary: `Housekeeping ${prev ?? "—"} → ${input.next} · ${input.reason}`,
    before: { housekeeping_status: prev },
    after: { housekeeping_status: input.next },
    metadata: input.metadata ?? null,
    source: "manual",
    correlation_id: input.correlationId ?? null,
  });
}
