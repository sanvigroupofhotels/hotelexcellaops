/**
 * Housekeeping reporting — pure aggregation over `housekeeping_tasks`.
 *
 * No new business logic: this module ONLY reads the immutable snapshots
 * (`consumables_snapshot`, `linen_snapshot`, `issues_snapshot`) written by
 * the shared HK engine (`src/lib/hk-tasks.ts`) and rolls them up for
 * operational dashboards. All calculations are derived; nothing is duplicated
 * from the write path.
 */
import { supabase } from "@/integrations/supabase/client";
import type { HkTaskRow } from "@/lib/hk-tasks";

export interface HkDailySummary {
  checkoutRoomsCleaned: number;
  continueStayServiced: number;
  skippedNotRequired: number;
  skippedDnd: number;
  pending: number;
  avgCleaningSecs: number | null;
  avgServiceSecs: number | null;
  totalTasks: number;
}

export interface HkStaffRow {
  performerId: string | null;
  performerName: string;
  checkoutDone: number;
  serviceDone: number;
  totalDone: number;
  avgCompletionSecs: number | null;
  consumablesUsed: number;
  linenSent: number;
  complaintsRaised: number;
}

export async function fetchHkTasksInRange(from: string, to: string): Promise<HkTaskRow[]> {
  const { data, error } = await supabase
    .from("housekeeping_tasks" as any)
    .select("*")
    .gte("business_date", from)
    .lte("business_date", to)
    .order("business_date", { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as HkTaskRow[];
}

function durationSecs(t: HkTaskRow): number | null {
  if (!t.started_at || !t.finished_at) return null;
  const s = new Date(t.started_at).getTime();
  const f = new Date(t.finished_at).getTime();
  if (!Number.isFinite(s) || !Number.isFinite(f) || f <= s) return null;
  return Math.floor((f - s) / 1000);
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.floor(values.reduce((a, b) => a + b, 0) / values.length);
}

export function computeHkDailySummary(tasks: HkTaskRow[]): HkDailySummary {
  let checkoutRoomsCleaned = 0;
  let continueStayServiced = 0;
  let skippedNotRequired = 0;
  let skippedDnd = 0;
  let pending = 0;
  const cleanDurations: number[] = [];
  const serviceDurations: number[] = [];

  for (const t of tasks) {
    if (t.state === "done") {
      if (t.type === "checkout_clean") {
        checkoutRoomsCleaned += 1;
        const d = durationSecs(t); if (d != null) cleanDurations.push(d);
      } else if (t.type === "continue_service") {
        continueStayServiced += 1;
        const d = durationSecs(t); if (d != null) serviceDurations.push(d);
      }
    } else if (t.state === "skipped") {
      if (t.skipped_reason === "not_required") skippedNotRequired += 1;
      else if (t.skipped_reason === "dnd") skippedDnd += 1;
    } else if (t.state === "open" || t.state === "in_progress") {
      pending += 1;
    }
  }

  return {
    checkoutRoomsCleaned,
    continueStayServiced,
    skippedNotRequired,
    skippedDnd,
    pending,
    avgCleaningSecs: mean(cleanDurations),
    avgServiceSecs: mean(serviceDurations),
    totalTasks: tasks.length,
  };
}

function sumQty(arr: any): number {
  if (!Array.isArray(arr)) return 0;
  return arr.reduce((s, x) => s + (Number(x?.qty) || 0), 0);
}

export function computeHkStaffPerformance(tasks: HkTaskRow[]): HkStaffRow[] {
  const byPerformer = new Map<string, HkStaffRow & { _durations: number[] }>();

  for (const t of tasks) {
    if (t.state !== "done") continue;
    const key = t.performed_by_user_id ?? `name:${t.performed_by_name ?? "unknown"}`;
    let row = byPerformer.get(key);
    if (!row) {
      row = {
        performerId: t.performed_by_user_id,
        performerName: t.performed_by_name ?? "Unknown",
        checkoutDone: 0,
        serviceDone: 0,
        totalDone: 0,
        avgCompletionSecs: null,
        consumablesUsed: 0,
        linenSent: 0,
        complaintsRaised: 0,
        _durations: [],
      };
      byPerformer.set(key, row);
    }
    if (t.type === "checkout_clean") row.checkoutDone += 1;
    else if (t.type === "continue_service") row.serviceDone += 1;
    row.totalDone += 1;
    const d = durationSecs(t); if (d != null) row._durations.push(d);
    row.consumablesUsed += sumQty(t.consumables_snapshot);
    row.linenSent += sumQty(t.linen_snapshot);
    row.complaintsRaised += Array.isArray(t.issues_snapshot) ? t.issues_snapshot.length : 0;
  }

  return Array.from(byPerformer.values())
    .map((r) => {
      const { _durations, ...rest } = r;
      return { ...rest, avgCompletionSecs: mean(_durations) };
    })
    .sort((a, b) => b.totalDone - a.totalDone);
}
