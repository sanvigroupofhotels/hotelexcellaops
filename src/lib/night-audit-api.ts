import { supabase } from "@/integrations/supabase/client";
import { toLocalYMD } from "@/lib/utils";

/**
 * Night Audit.
 *
 * Business date is stored as a single row in `app_settings` under key
 * `business_date` ({ date: "YYYY-MM-DD" }). We never advance the date
 * automatically until pending check-ins / check-outs are resolved.
 *
 * Blocker matrix (v1.1 UAT-019):
 *   • Pending check-ins  : any booking with status ∉ (Checked-In, Checked-Out,
 *                          Cancelled, Stay Completed, No-Show) and
 *                          check_in ≤ business_date.
 *   • Pending check-outs : status = Checked-In and check_out ≤ business_date.
 *   • Room mismatches    : any Checked-In booking with a non-null room_id whose
 *                          `rooms.housekeeping_status` is still `occupied` from
 *                          a prior stay (rare — surfaces stale HK state).
 * If any blocker is non-empty, Business Date advancement is refused.
 */

export interface PendingBooking {
  id: string;
  booking_reference: string;
  guest_name: string;
  phone: string | null;
  check_in: string;
  check_out: string;
  status: string;
  room_id: string | null;
  room_number?: string | null;
}

export async function getBusinessDate(): Promise<string> {
  const { data } = await supabase
    .from("app_settings" as any)
    .select("value")
    .eq("key", "business_date")
    .maybeSingle();
  const v = (data as any)?.value?.date as string | undefined;
  return v || toLocalYMD();
}

export async function setBusinessDate(date: string): Promise<void> {
  const { error } = await supabase
    .from("app_settings" as any)
    .upsert({ key: "business_date", value: { date }, updated_at: new Date().toISOString() } as any);
  if (error) throw error;
}

export async function getPendingForAudit(businessDate?: string): Promise<{
  businessDate: string;
  pendingCheckIns: PendingBooking[];
  pendingCheckOuts: PendingBooking[];
}> {
  const bd = businessDate ?? (await getBusinessDate());

  const [{ data: ci }, { data: co }, { data: rooms }] = await Promise.all([
    // Pending Check-In = arrival scheduled ON or BEFORE the business date that
    // hasn't been checked-in yet. Today's arrivals count as pending: Business
    // Date must never advance while any expected guest is still un-arrived.
    // Includes `Pending`, `Confirmed`, `Draft`, `Advance Paid`, etc.
    supabase.from("bookings" as any).select("id,booking_reference,guest_name,phone,check_in,check_out,status,room_id")
      .lte("check_in", bd)
      .not("status", "in", "(Checked-In,Checked-Out,Cancelled,Stay Completed,No-Show)")
      .order("check_in", { ascending: true }),
    // Pending Check-Out = still Checked-In with a departure ON or BEFORE the
    // business date. Same rule: closing the day requires departures to be
    // resolved (checked out, extended, or otherwise handled).
    supabase.from("bookings" as any).select("id,booking_reference,guest_name,phone,check_in,check_out,status,room_id")
      .lte("check_out", bd)
      .eq("status", "Checked-In" as any)
      .order("check_out", { ascending: true }),
    supabase.from("rooms" as any).select("id,room_number"),
  ]);

  const roomMap = new Map<string, string>((rooms ?? []).map((r: any) => [r.id, r.room_number]));
  const decorate = (rows: any[] = []): PendingBooking[] => rows.map((r) => ({
    ...r,
    room_number: r.room_id ? (roomMap.get(r.room_id) ?? null) : null,
  }));

  return {
    businessDate: bd,
    pendingCheckIns: decorate(ci ?? []),
    pendingCheckOuts: decorate(co ?? []),
  };
}

export interface PerformAuditResult {
  ok: boolean;
  reason?: "pending_check_ins" | "pending_check_outs" | "already_done";
  pendingCheckIns?: number;
  pendingCheckOuts?: number;
  previousBusinessDate?: string;
  newBusinessDate?: string;
}

/**
 * @deprecated Business Date advancement is owned exclusively by
 * `closeSession()` in `night-audit-sessions-api.ts`. This legacy entry
 * point now throws so no other code path can advance the business date.
 */
export async function performNightAudit(_opts: { mode?: "manual" | "auto"; actorName?: string | null } = {}): Promise<PerformAuditResult> {
  throw new Error(
    "performNightAudit() is disabled. Business Date can only be advanced by closing a Night Audit session (Night Audit → Review → Close Session).",
  );
}

/** Bulk operations used by the Night Audit dialog. */
export async function bulkSetStatus(ids: string[], status: "Checked-In" | "Checked-Out" | "Cancelled"): Promise<void> {
  const { setBookingStatus } = await import("@/lib/bookings-api");
  const { logBookingActivity } = await import("@/lib/booking-activities-api");
  for (const id of ids) {
    await setBookingStatus(id, status as any);
    await logBookingActivity({
      booking_id: id,
      action: status === "Checked-In" ? "check_in" : status === "Checked-Out" ? "check_out" : "cancelled",
      from_status: null, to_status: status,
      notes: "From Night Audit (bulk)",
    });
  }
}

export interface NightAuditRun {
  id: string;
  actor_name: string | null;
  mode: string;
  previous_business_date: string | null;
  new_business_date: string;
  pending_check_ins_resolved: number;
  pending_check_outs_resolved: number;
  notes: string | null;
  created_at: string;
}

export async function listNightAuditRuns(limit = 200): Promise<NightAuditRun[]> {
  const { data, error } = await supabase
    .from("night_audit_runs" as any)
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as any;
}
