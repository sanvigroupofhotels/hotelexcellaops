/**
 * Housekeeping reporting — pure aggregation over `housekeeping_tasks` +
 * `bookings` + `housekeeping_room_exceptions`.
 *
 * No new business logic on the write path: this module ONLY reads the
 * immutable snapshots (`consumables_snapshot`, `linen_snapshot`,
 * `issues_snapshot`) written by the shared HK engine (`src/lib/hk-tasks.ts`)
 * and rolls them up. The Exception Audit derives the "expected rooms" set
 * from the exact same predicates the night-audit generator uses
 * (`hk-generator.ts`) plus the checkout hook path — so anything missing or
 * unexpected in a day's task list will surface without re-implementing the
 * generator.
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

/* ─────────────────────────────  Work History  ───────────────────────────── */

export interface HkWorkHistoryRow {
  task_id: string;
  business_date: string;
  room_number: string | null;
  room_type: string | null;
  type: HkTaskRow["type"];
  state: HkTaskRow["state"];
  skipped_reason: HkTaskRow["skipped_reason"];
  origin: HkTaskRow["origin"];
  manual_reason: string | null;
  started_at: string | null;
  finished_at: string | null;
  duration_secs: number | null;
  performed_by: string | null;
  recorded_by: string | null;
  consumables_qty: number;
  linen_qty: number;
  issues_count: number;
  remarks: string | null;
}

function sumQtyLocal(arr: any): number {
  if (!Array.isArray(arr)) return 0;
  return arr.reduce((s, x) => s + (Number(x?.qty) || 0), 0);
}

export async function fetchWorkHistoryInRange(from: string, to: string): Promise<HkWorkHistoryRow[]> {
  const [{ data: tasks, error: tErr }, { data: rooms, error: rErr }] = await Promise.all([
    supabase
      .from("housekeeping_tasks" as any)
      .select("*")
      .gte("business_date", from)
      .lte("business_date", to)
      .order("business_date", { ascending: true })
      .order("started_at", { ascending: true, nullsFirst: false } as any),
    supabase.from("rooms" as any).select("id, room_number, room_type"),
  ]);
  if (tErr) throw tErr;
  if (rErr) throw rErr;
  const roomMap = new Map<string, { room_number: string | null; room_type: string | null }>();
  for (const r of ((rooms ?? []) as any[])) roomMap.set(r.id, { room_number: r.room_number ?? null, room_type: r.room_type ?? null });

  return ((tasks ?? []) as unknown as HkTaskRow[]).map((t) => {
    const rm = roomMap.get(t.room_id);
    return {
      task_id: t.id,
      business_date: t.business_date,
      room_number: rm?.room_number ?? null,
      room_type: rm?.room_type ?? null,
      type: t.type,
      state: t.state,
      origin: t.origin ?? "auto_night_audit",
      manual_reason: t.manual_reason ?? null,
      started_at: t.started_at,
      finished_at: t.finished_at,
      duration_secs: durationSecs(t),
      performed_by: t.performed_by_name,
      recorded_by: t.recorded_by_name,
      consumables_qty: sumQtyLocal(t.consumables_snapshot),
      linen_qty: sumQtyLocal(t.linen_snapshot),
      issues_count: Array.isArray(t.issues_snapshot) ? t.issues_snapshot.length : 0,
      remarks: t.remarks,
    };
  });
}

/* ────────────────────────────  Exception Audit  ─────────────────────────── */

export interface HkExceptionRow {
  business_date: string;
  expected_rooms: string[];       // room_numbers
  actual_rooms: string[];         // room_numbers with any task that day
  missing_rooms: string[];        // expected − actual
  unexpected_rooms: string[];     // actual − expected
}

/**
 * Reconstruct the "expected rooms" set per business date the same way the
 * write path decides who gets a task:
 *   • Checkout expected = bookings whose check_out == business_date AND
 *     status IN ('Checked-In','Checked-Out','Stay Completed') AND room_id NOT NULL.
 *   • Service expected  = bookings occupied overnight (check_in < bd AND
 *     check_out > bd AND status = 'Checked-In'), minus any room with an
 *     HK exception row (DND / Service Not Required).
 * Actual = rooms with any housekeeping_task for that business date that
 * wasn't superseded by a later checkout. Result lists per-day missing and
 * unexpected sets — the operational lens management asked for.
 */
export async function fetchHkExceptionAudit(from: string, to: string): Promise<HkExceptionRow[]> {
  const [{ data: rooms }, { data: bookings }, { data: exceptions }, { data: tasks }] = await Promise.all([
    supabase.from("rooms" as any).select("id, room_number"),
    supabase
      .from("bookings" as any)
      .select("id, room_id, check_in, check_out, status")
      .lte("check_in", to)
      .gte("check_out", from)
      .not("status", "in", "(Cancelled,No-Show,Draft)"),
    supabase
      .from("housekeeping_room_exceptions" as any)
      .select("room_id, business_date")
      .gte("business_date", from)
      .lte("business_date", to),
    supabase
      .from("housekeeping_tasks" as any)
      .select("room_id, business_date, state, skipped_reason")
      .gte("business_date", from)
      .lte("business_date", to),
  ]);

  const roomNum = new Map<string, string>();
  for (const r of ((rooms ?? []) as any[])) roomNum.set(r.id, String(r.room_number ?? r.id));

  const exceptionSet = new Set<string>();
  for (const e of ((exceptions ?? []) as any[])) exceptionSet.add(`${e.business_date}|${e.room_id}`);

  // Enumerate dates in range
  const dates: string[] = [];
  const cursor = new Date(from + "T00:00:00");
  const end = new Date(to + "T00:00:00");
  while (cursor <= end) { dates.push(cursor.toISOString().slice(0, 10)); cursor.setDate(cursor.getDate() + 1); }

  const out: HkExceptionRow[] = [];
  for (const bd of dates) {
    const expected = new Set<string>();
    for (const b of ((bookings ?? []) as any[])) {
      if (!b.room_id) continue;
      const ci = b.check_in as string; const co = b.check_out as string;
      // Checkout expected
      if (co === bd && (b.status === "Checked-In" || b.status === "Checked-Out" || b.status === "Stay Completed")) {
        expected.add(b.room_id);
      }
      // Service expected (occupied overnight)
      if (ci < bd && co > bd && b.status === "Checked-In") {
        if (!exceptionSet.has(`${bd}|${b.room_id}`)) expected.add(b.room_id);
      }
    }
    const actual = new Set<string>();
    for (const t of ((tasks ?? []) as any[])) {
      if (t.business_date !== bd) continue;
      if (t.state === "skipped" && t.skipped_reason === "superseded_by_checkout") continue;
      actual.add(t.room_id);
    }
    const missing = [...expected].filter((r) => !actual.has(r));
    const unexpected = [...actual].filter((r) => !expected.has(r));
    out.push({
      business_date: bd,
      expected_rooms: [...expected].map((r) => roomNum.get(r) ?? r).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true})),
      actual_rooms:   [...actual].map((r) => roomNum.get(r) ?? r).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true})),
      missing_rooms:  missing.map((r) => roomNum.get(r) ?? r).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true})),
      unexpected_rooms: unexpected.map((r) => roomNum.get(r) ?? r).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true})),
    });
  }
  return out;
}
