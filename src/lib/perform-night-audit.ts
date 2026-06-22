/**
 * Treebo-style "Perform Night Audit" — one-click advance.
 *
 * - Refuses if Pending Check-ins or Pending Check-outs exist.
 * - Outstanding dues do NOT block the audit (informational only).
 * - Opens (or resumes) a session for the current business date, then
 *   immediately closes it with a snapshot of totals. Business Date advances
 *   by +1 atomically inside `closeSession()`.
 *
 * This is the ONLY caller-facing way to advance Business Date.
 */
import { supabase } from "@/integrations/supabase/client";
import { getPendingForAudit } from "@/lib/night-audit-api";
import { openOrResumeSession, closeSession } from "@/lib/night-audit-sessions-api";

export interface PerformResult {
  ok: boolean;
  previousBusinessDate?: string;
  newBusinessDate?: string;
  pendingCheckIns?: number;
  pendingCheckOuts?: number;
  reason?: "pending";
}

export async function performNightAuditNow(): Promise<PerformResult> {
  const pending = await getPendingForAudit();
  if (pending.pendingCheckIns.length > 0 || pending.pendingCheckOuts.length > 0) {
    return {
      ok: false,
      reason: "pending",
      pendingCheckIns: pending.pendingCheckIns.length,
      pendingCheckOuts: pending.pendingCheckOuts.length,
    };
  }
  const bd = pending.businessDate;
  const totals = await snapshotEodTotals(bd);
  const session = await openOrResumeSession();
  const { newBusinessDate } = await closeSession({
    sessionId: session.id,
    totals,
  });
  return { ok: true, previousBusinessDate: bd, newBusinessDate };
}

/** Lightweight snapshot persisted into night_audit_sessions.totals for the EOD report. */
async function snapshotEodTotals(businessDate: string): Promise<Record<string, any>> {
  // Stays active on the business date: check_in <= bd < check_out, status not cancelled/no-show
  const dayStart = `${businessDate}T00:00:00`;
  const dayEnd = `${businessDate}T23:59:59`;

  const [{ data: stays }, { data: rooms }, { data: payments }] = await Promise.all([
    supabase
      .from("bookings" as any)
      .select("id,amount,advance_paid,status,room_id,check_in,check_out")
      .lte("check_in", businessDate)
      .gt("check_out", businessDate)
      .not("status", "in", "(Cancelled,No-Show,Draft)"),
    supabase.from("rooms" as any).select("id,active"),
    supabase
      .from("booking_payments" as any)
      .select("amount,payment_mode,is_refund,occurred_at")
      .gte("occurred_at", dayStart)
      .lte("occurred_at", dayEnd),
  ]);

  const activeRooms = (rooms ?? []).filter((r: any) => r.active !== false).length;
  const occupiedRoomIds = new Set<string>();
  let roomRevenue = 0;
  let pendingDues = 0;
  for (const s of (stays ?? []) as any[]) {
    if (s.room_id) occupiedRoomIds.add(s.room_id);
    const amt = Number(s.amount ?? 0);
    const paid = Number(s.advance_paid ?? 0);
    roomRevenue += amt;
    pendingDues += Math.max(0, amt - paid);
  }

  let cashCollected = 0;
  let cardCollected = 0;
  let onlineCollected = 0;
  for (const p of (payments ?? []) as any[]) {
    const sign = p.is_refund ? -1 : 1;
    const amt = sign * Number(p.amount ?? 0);
    const mode = String(p.payment_mode ?? "").toLowerCase();
    if (mode === "cash") cashCollected += amt;
    else if (mode === "card") cardCollected += amt;
    else onlineCollected += amt;
  }
  const totalCollected = cashCollected + cardCollected + onlineCollected;
  const totalRooms = activeRooms || 0;
  const roomsSold = occupiedRoomIds.size;

  return {
    business_date: businessDate,
    rooms_total: totalRooms,
    rooms_sold: roomsSold,
    rooms_vacant: Math.max(0, totalRooms - roomsSold),
    occupancy_pct: totalRooms > 0 ? Math.round((roomsSold / totalRooms) * 10000) / 100 : 0,
    revenue_room: roomRevenue,
    revenue_total: roomRevenue,
    cash_collected: cashCollected,
    card_collected: cardCollected,
    online_collected: onlineCollected,
    total_collected: totalCollected,
    pending_dues: pendingDues,
    pending_check_ins: 0,
    pending_check_outs: 0,
  };
}
