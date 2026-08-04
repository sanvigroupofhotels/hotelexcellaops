/**
 * Automatic Night Audit scheduler.
 *
 * ONE implementation, TWO callers:
 *   • pg_cron → POST /api/public/night-audit-run (06:00 IST daily)
 *   • Reception → the same engine via the Night Audit screens
 *
 * It does NOT re-implement any audit logic. It drives the canonical shared
 * engine (`openOrResumeSession` + `closeSession` from
 * `night-audit-sessions-api.ts`), which owns validation, decision logging,
 * Business Date advancement and housekeeping fan-out.
 *
 * Guarantees:
 *   • Idempotent — a second invocation for the same Business Date is a no-op
 *     (`already_current` / `already_ran`).
 *   • Never advances past today's Asia/Kolkata calendar date.
 *   • Never advances while pending check-ins / check-outs exist — it reports
 *     `blocked` with counts so Reception can be alerted.
 *   • Catches up multiple lagging days (bounded) in one run.
 *   • Every outcome is logged to `night_audit_runs` + the activity log.
 */
import { db } from "@/lib/db";
import { getBusinessDate, getPendingForAudit } from "@/lib/night-audit-api";
import {
  closeSession,
  openOrResumeSession,
  NightAuditPendingError,
} from "@/lib/night-audit-sessions-api";
import { logActivity, newCorrelationId } from "@/lib/activity-log";

export type ScheduledAuditStatus =
  | "advanced"
  | "already_current"
  | "already_ran"
  | "blocked"
  | "failed";

export interface ScheduledAuditResult {
  ok: boolean;
  status: ScheduledAuditStatus;
  businessDateBefore: string;
  businessDateAfter: string;
  calendarDate: string;
  daysAdvanced: number;
  pendingCheckIns?: number;
  pendingCheckOuts?: number;
  error?: string;
  durationMs: number;
  correlationId: string;
}

/** Today's date in Asia/Kolkata (matches the DB business-date guard). */
export function istToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Max business dates a single scheduled run may catch up. */
const MAX_CATCH_UP_DAYS = 7;

export async function runScheduledNightAudit(opts: {
  actorName?: string | null;
  /** Injected for tests. */
  now?: Date;
} = {}): Promise<ScheduledAuditResult> {
  const startedAt = Date.now();
  const correlationId = newCorrelationId();
  const actorName = opts.actorName ?? "Automatic Night Audit";
  const calendarDate = istToday(opts.now);
  const businessDateBefore = await getBusinessDate();

  const finish = (
    status: ScheduledAuditStatus,
    extra: Partial<ScheduledAuditResult> & { businessDateAfter: string },
  ): ScheduledAuditResult => ({
    ok: status === "advanced" || status === "already_current" || status === "already_ran",
    status,
    businessDateBefore,
    calendarDate,
    daysAdvanced: 0,
    durationMs: Date.now() - startedAt,
    correlationId,
    ...extra,
  });

  // Nothing to do — Business Date already matches (or leads) the calendar day.
  if (businessDateBefore >= calendarDate) {
    return finish("already_current", { businessDateAfter: businessDateBefore });
  }

  // Idempotency guard: did an automatic run already close this Business Date?
  const { data: priorRun } = await db()
    .from("night_audit_runs" as any)
    .select("id")
    .eq("mode", "auto")
    .eq("previous_business_date", businessDateBefore)
    .limit(1)
    .maybeSingle();
  if (priorRun) {
    return finish("already_ran", { businessDateAfter: businessDateBefore });
  }

  let current = businessDateBefore;
  let daysAdvanced = 0;

  try {
    while (current < calendarDate && daysAdvanced < MAX_CATCH_UP_DAYS) {
      const pending = await getPendingForAudit(current);
      if (pending.pendingCheckIns.length > 0 || pending.pendingCheckOuts.length > 0) {
        await recordRun({
          mode: "auto",
          actorName,
          previous: current,
          next: current,
          checkIns: pending.pendingCheckIns.length,
          checkOuts: pending.pendingCheckOuts.length,
          notes: `Blocked — ${pending.pendingCheckIns.length} pending check-in(s), ${pending.pendingCheckOuts.length} pending check-out(s)`,
        });
        void logActivity({
          page: "Night Audit",
          action: "night_audit_scheduler_blocked",
          entity_type: "night_audit_session",
          entity_reference: current,
          summary: `Automatic night audit blocked on ${current} — pending operational work`,
          metadata: {
            pending_check_ins: pending.pendingCheckIns.length,
            pending_check_outs: pending.pendingCheckOuts.length,
            days_advanced: daysAdvanced,
          },
          source: "system",
          correlation_id: correlationId,
        });
        return finish("blocked", {
          businessDateAfter: current,
          daysAdvanced,
          pendingCheckIns: pending.pendingCheckIns.length,
          pendingCheckOuts: pending.pendingCheckOuts.length,
        });
      }

      const session = await openOrResumeSession(actorName);
      const { newBusinessDate } = await closeSession({
        sessionId: session.id,
        actorName,
        totals: { source: "scheduler", correlation_id: correlationId },
      });

      await recordRun({
        mode: "auto",
        actorName,
        previous: current,
        next: newBusinessDate,
        checkIns: 0,
        checkOuts: 0,
        notes: `Automatic night audit · session ${session.id}`,
      });

      current = newBusinessDate;
      daysAdvanced += 1;
    }

    void logActivity({
      page: "Night Audit",
      action: "night_audit_scheduler_completed",
      entity_type: "night_audit_session",
      entity_reference: current,
      summary: `Automatic night audit advanced Business Date ${businessDateBefore} → ${current}`,
      before: { business_date: businessDateBefore },
      after: { business_date: current },
      metadata: { days_advanced: daysAdvanced, calendar_date: calendarDate },
      source: "system",
      correlation_id: correlationId,
    });

    return finish("advanced", { businessDateAfter: current, daysAdvanced });
  } catch (e: any) {
    const isPending = e instanceof NightAuditPendingError;
    void logActivity({
      page: "Night Audit",
      action: "night_audit_scheduler_failed",
      entity_type: "night_audit_session",
      entity_reference: current,
      summary: `Automatic night audit failed on ${current}: ${e?.message ?? "unknown error"}`,
      metadata: { days_advanced: daysAdvanced, pending: isPending },
      source: "system",
      correlation_id: correlationId,
    });
    return finish(isPending ? "blocked" : "failed", {
      businessDateAfter: current,
      daysAdvanced,
      pendingCheckIns: isPending ? e.pendingCheckIns.length : undefined,
      pendingCheckOuts: isPending ? e.pendingCheckOuts.length : undefined,
      error: e?.message ?? "unknown error",
    });
  }
}

async function recordRun(input: {
  mode: "auto" | "manual";
  actorName: string;
  previous: string;
  next: string;
  checkIns: number;
  checkOuts: number;
  notes: string;
}): Promise<void> {
  try {
    await db()
      .from("night_audit_runs" as any)
      .insert({
        mode: input.mode,
        actor_name: input.actorName,
        previous_business_date: input.previous,
        new_business_date: input.next,
        pending_check_ins_resolved: input.checkIns,
        pending_check_outs_resolved: input.checkOuts,
        notes: input.notes,
      } as any);
  } catch {
    /* telemetry must never break the audit */
  }
}
