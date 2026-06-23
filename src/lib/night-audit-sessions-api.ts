/**
 * Night Audit Sessions & Decisions API.
 *
 * Business Date NEVER advances automatically. The only way to advance it is
 * via `closeSession()` after every gate has been resolved (or overridden by
 * an admin with a recorded reason).
 *
 * A session is the unit of work for one business date. Every CI / CO /
 * Cancel / No-Show / Override / Reopen / BD-advance is logged as an
 * append-only decision row tied to the active session.
 */

import { supabase } from "@/integrations/supabase/client";
import { getBusinessDate, setBusinessDate } from "@/lib/night-audit-api";

export type NightAuditSessionStatus = "open" | "closed" | "reopened";

export interface NightAuditSession {
  id: string;
  business_date: string;
  status: NightAuditSessionStatus;
  opened_at: string;
  opened_by_id: string | null;
  opened_by_name: string | null;
  closed_at: string | null;
  closed_by_id: string | null;
  closed_by_name: string | null;
  reopen_reason: string | null;
  totals: Record<string, any>;
  eod_html: string | null;
}

export interface NightAuditDecision {
  id: string;
  session_id: string;
  business_date: string;
  step: string;
  action: string;
  booking_id: string | null;
  before_status: string | null;
  after_status: string | null;
  reason: string | null;
  payload: Record<string, any>;
  actor_id: string | null;
  actor_name: string | null;
  actor_role: string | null;
  created_at: string;
}

/** Get the currently open session for the given business date, if any. */
export async function getOpenSession(
  businessDate?: string,
): Promise<NightAuditSession | null> {
  const bd = businessDate ?? (await getBusinessDate());
  const { data, error } = await supabase
    .from("night_audit_sessions" as any)
    .select("*")
    .eq("business_date", bd)
    .eq("status", "open")
    .maybeSingle();
  if (error) throw error;
  return (data as any) ?? null;
}

/** Open (or resume) a session for the current business date. */
export async function openOrResumeSession(
  actorName?: string | null,
): Promise<NightAuditSession> {
  const bd = await getBusinessDate();
  const existing = await getOpenSession(bd);
  if (existing) return existing;

  const { data: userRes } = await supabase.auth.getUser();
  const uid = userRes?.user?.id ?? null;

  const { data, error } = await supabase
    .from("night_audit_sessions" as any)
    .insert({
      business_date: bd,
      status: "open",
      opened_by_id: uid,
      opened_by_name: actorName ?? userRes?.user?.email ?? null,
    } as any)
    .select("*")
    .single();

  // Concurrency: a partial unique index on (business_date) WHERE status='open'
  // guarantees only one open session per BD. If another user beat us to it,
  // resume that session instead of surfacing the unique violation.
  if (error) {
    if ((error as any).code === "23505") {
      const resumed = await getOpenSession(bd);
      if (resumed) return resumed;
    }
    throw error;
  }
  return data as any;
}

/** Close the session and advance the business date by +1. */
export async function closeSession(opts: {
  sessionId: string;
  totals?: Record<string, any>;
  eodHtml?: string | null;
  overrideReason?: string | null;
  actorName?: string | null;
}): Promise<{ newBusinessDate: string }> {
  const { data: userRes } = await supabase.auth.getUser();
  const uid = userRes?.user?.id ?? null;

  const { data: session, error: sErr } = await supabase
    .from("night_audit_sessions" as any)
    .select("business_date,status")
    .eq("id", opts.sessionId)
    .maybeSingle();
  if (sErr) throw sErr;
  if (!session) throw new Error("Session not found");
  if ((session as any).status !== "open")
    throw new Error("Session is not open");

  const bd = (session as any).business_date as string;
  const next = addDays(bd, 1);

  // Business Date can NEVER move into the future. The same rule is enforced
  // at the database level (trigger on app_settings.business_date), but we
  // surface a friendlier error here before flipping the session row.
  const todayLocal = (() => {
    // Use Asia/Kolkata to match the server-side guard.
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
    });
    return fmt.format(new Date()); // YYYY-MM-DD
  })();
  if (next > todayLocal) {
    throw new Error(
      `Night Audit cannot advance Business Date to ${next} because it would exceed today's calendar date (${todayLocal}). Wait until tomorrow to close this session.`,
    );
  }


  // Concurrency guard: filter on status='open' so only the writer that
  // actually flipped open→closed proceeds to advance the business date.
  // A simultaneous second close gets an empty rowset and errors out cleanly.
  const { data: closedRows, error: uErr } = await supabase
    .from("night_audit_sessions" as any)
    .update({
      status: "closed",
      closed_at: new Date().toISOString(),
      closed_by_id: uid,
      closed_by_name: opts.actorName ?? userRes?.user?.email ?? null,
      totals: opts.totals ?? {},
      eod_html: opts.eodHtml ?? null,
    } as any)
    .eq("id", opts.sessionId)
    .eq("status", "open")
    .select("id");
  if (uErr) throw uErr;
  if (!closedRows || (closedRows as any[]).length === 0) {
    throw new Error("Session was already closed by another user. Refresh to see the latest state.");
  }

  // Log advance decision BEFORE bumping BD so the decision row carries the old BD.
  await logDecision({
    sessionId: opts.sessionId,
    step: "close",
    action: "business_date_advance",
    beforeStatus: bd,
    afterStatus: next,
    reason: opts.overrideReason ?? null,
    payload: { totals: opts.totals ?? {} },
  });

  await setBusinessDate(next);
  return { newBusinessDate: next };
}

/** Persist in-progress reconciliation/review draft into session.totals. */
export async function saveSessionDraft(opts: {
  sessionId: string;
  draft: Record<string, any>;
}): Promise<void> {
  // Merge with existing totals so we don't blow away a final close payload.
  const { data: existing, error: rErr } = await supabase
    .from("night_audit_sessions" as any)
    .select("totals,status")
    .eq("id", opts.sessionId)
    .maybeSingle();
  if (rErr) throw rErr;
  if (!existing) return;
  if ((existing as any).status !== "open") return; // only persist while open

  const next = {
    ...(((existing as any).totals as Record<string, any>) ?? {}),
    draft: { ...opts.draft, updated_at: new Date().toISOString() },
  };

  const { error } = await supabase
    .from("night_audit_sessions" as any)
    .update({ totals: next } as any)
    .eq("id", opts.sessionId)
    .eq("status", "open");
  if (error) throw error;
}

/** Reopen the most recently closed session for an admin-led correction.
 *  Concurrency-safe: only the writer that flips closed→reopened proceeds to
 *  log + roll back the business date. A simultaneous second reopen sees
 *  zero rows updated and throws cleanly with no duplicate side effects. */
export async function reopenLastClosedSession(opts: {
  reason: string;
  actorName?: string | null;
}): Promise<NightAuditSession> {
  if (!opts.reason?.trim())
    throw new Error("A reason is required to reopen a closed session");

  const { data: last, error } = await supabase
    .from("night_audit_sessions" as any)
    .select("*")
    .eq("status", "closed")
    .order("closed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!last) throw new Error("No closed session to reopen");

  const { data: userRes } = await supabase.auth.getUser();
  const uid = userRes?.user?.id ?? null;

  const bd = (last as any).business_date as string;

  // Concurrency guard — only the writer that actually flips closed→reopened
  // proceeds. Filter on status='closed' so a racing second reopen finds zero
  // rows and we throw without duplicating logs or rolling BD back twice.
  const { data: updRows, error: uErr } = await supabase
    .from("night_audit_sessions" as any)
    .update({
      status: "reopened",
      reopen_reason: opts.reason,
      closed_at: null,
      closed_by_id: null,
      closed_by_name: null,
    } as any)
    .eq("id", (last as any).id)
    .eq("status", "closed")
    .select("*");
  if (uErr) throw uErr;
  if (!updRows || (updRows as any[]).length === 0) {
    throw new Error("Session already reopened by another user. Refresh to see the latest state.");
  }
  const upd = (updRows as any[])[0];

  // Only after we won the race: roll BD back to this session's business_date.
  await setBusinessDate(bd);

  await logDecision({
    sessionId: (last as any).id,
    step: "reopen",
    action: "session_reopened",
    reason: opts.reason,
    payload: { actor: opts.actorName ?? userRes?.user?.email ?? null, by_id: uid },
  });

  return upd as any;
}


/** Append an immutable decision to the session log. */
export async function logDecision(opts: {
  sessionId: string;
  step: string;
  action: string;
  bookingId?: string | null;
  beforeStatus?: string | null;
  afterStatus?: string | null;
  reason?: string | null;
  payload?: Record<string, any>;
}): Promise<void> {
  const { data: userRes } = await supabase.auth.getUser();
  const uid = userRes?.user?.id ?? null;

  // Best-effort role lookup
  let role: string | null = null;
  if (uid) {
    const { data } = await supabase
      .from("user_roles" as any)
      .select("role")
      .eq("user_id", uid)
      .limit(1)
      .maybeSingle();
    role = (data as any)?.role ?? null;
  }

  const { data: session } = await supabase
    .from("night_audit_sessions" as any)
    .select("business_date")
    .eq("id", opts.sessionId)
    .maybeSingle();

  const { error } = await supabase.from("night_audit_decisions" as any).insert({
    session_id: opts.sessionId,
    business_date: (session as any)?.business_date ?? new Date().toISOString().slice(0, 10),
    step: opts.step,
    action: opts.action,
    booking_id: opts.bookingId ?? null,
    before_status: opts.beforeStatus ?? null,
    after_status: opts.afterStatus ?? null,
    reason: opts.reason ?? null,
    payload: opts.payload ?? {},
    actor_id: uid,
    actor_name: userRes?.user?.email ?? null,
    actor_role: role,
  } as any);
  if (error) throw error;
}

/** List decisions for a session in chronological order. */
export async function listDecisions(
  sessionId: string,
): Promise<NightAuditDecision[]> {
  const { data, error } = await supabase
    .from("night_audit_decisions" as any)
    .select("*")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data as any) ?? [];
}

function addDays(ymd: string, n: number): string {
  const d = new Date(ymd + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
