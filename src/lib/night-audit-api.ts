import { db } from "@/lib/db";
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
  const { data } = await db()
    .from("app_settings" as any)
    .select("value")
    .eq("key", "business_date")
    .maybeSingle();
  const v = (data as any)?.value?.date as string | undefined;
  return v || toLocalYMD();
}

export async function setBusinessDate(date: string): Promise<void> {
  const { error } = await db()
    .from("app_settings" as any)
    .upsert({ key: "business_date", value: { date }, updated_at: new Date().toISOString() } as any);
  if (error) throw error;
}

/**
 * ITEM-AWARE pending computation (UAT-054).
 *
 * A multi-room booking is a set of independent Booking Items, each with its own
 * arrival/departure dates and its own lifecycle. Night Audit must therefore
 * judge PER ROOM, not on the parent booking row:
 *
 *   • Pending check-in  → the booking has at least one item whose own
 *     `check_in <= business_date` and whose `item_status` is still pre-arrival
 *     (Confirmed / null). Items arriving AFTER the business date can never be
 *     checked in yet, so they must never block the audit.
 *   • Pending check-out → the booking has at least one item still `Checked-In`
 *     whose own `check_out < business_date` (overdue departure).
 *
 * Bookings with no items fall back to the parent booking dates/status.
 */
const PRE_ARRIVAL_ITEM = new Set(["Confirmed", "Pending", "Draft", ""]);
const TERMINAL_ITEM = new Set(["Cancelled", "No-Show", "Removed", "Checked-Out"]);

export async function getPendingForAudit(businessDate?: string): Promise<{
  businessDate: string;
  pendingCheckIns: PendingBooking[];
  pendingCheckOuts: PendingBooking[];
}> {
  const bd = businessDate ?? (await getBusinessDate());
  const SELECT = "id,booking_reference,guest_name,phone,check_in,check_out,status,room_id";

  const [{ data: ci }, { data: co }, { data: rooms }] = await Promise.all([
    // Candidate arrivals — parent arrival on/before the business date and not
    // in a terminal state. Item-level filtering happens below.
    db().from("bookings" as any).select(SELECT)
      .lte("check_in", bd)
      .not("status", "in", "(Checked-Out,Cancelled,Stay Completed,No-Show)")
      .order("check_in", { ascending: true }),
    // UAT-037: only OVERDUE departures block (check_out < bd). Same-day
    // departures are processed during the audit itself.
    db().from("bookings" as any).select(SELECT)
      .lt("check_out", bd)
      .not("status", "in", "(Checked-Out,Cancelled,Stay Completed,No-Show,Draft)")
      .order("check_out", { ascending: true }),
    db().from("rooms" as any).select("id,room_number"),
  ]);

  const candidateIds = Array.from(new Set([
    ...((ci ?? []) as any[]).map((r) => r.id as string),
    ...((co ?? []) as any[]).map((r) => r.id as string),
  ]));

  const itemsByBooking = new Map<string, any[]>();
  if (candidateIds.length > 0) {
    const { data: items } = await db()
      .from("booking_items" as any)
      .select("booking_id,check_in,check_out,item_status")
      .in("booking_id", candidateIds);
    for (const it of ((items ?? []) as any[])) {
      const list = itemsByBooking.get(it.booking_id) ?? [];
      list.push(it);
      itemsByBooking.set(it.booking_id, list);
    }
  }

  const hasPendingArrival = (b: any): boolean => {
    const items = itemsByBooking.get(b.id) ?? [];
    if (items.length === 0) return true; // legacy booking — parent row decides
    return items.some((it) => {
      const st = String(it.item_status ?? "Confirmed");
      if (TERMINAL_ITEM.has(st) || st === "Checked-In") return false;
      if (!PRE_ARRIVAL_ITEM.has(st)) return false;
      const arrival = String(it.check_in ?? b.check_in ?? "");
      return arrival !== "" && arrival <= bd;
    });
  };

  const hasOverdueDeparture = (b: any): boolean => {
    const items = itemsByBooking.get(b.id) ?? [];
    if (items.length === 0) return String(b.status) === "Checked-In";
    return items.some((it) => {
      if (String(it.item_status ?? "") !== "Checked-In") return false;
      const departure = String(it.check_out ?? b.check_out ?? "");
      return departure !== "" && departure < bd;
    });
  };

  const roomMap = new Map<string, string>((rooms ?? []).map((r: any) => [r.id, r.room_number]));
  const decorate = (rows: any[] = []): PendingBooking[] => rows.map((r) => ({
    ...r,
    room_number: r.room_id ? (roomMap.get(r.room_id) ?? null) : null,
  }));

  return {
    businessDate: bd,
    pendingCheckIns: decorate(((ci ?? []) as any[]).filter(hasPendingArrival)),
    pendingCheckOuts: decorate(((co ?? []) as any[]).filter(hasOverdueDeparture)),
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
  const { data, error } = await db()
    .from("night_audit_runs" as any)
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as any;
}
