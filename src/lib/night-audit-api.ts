import { supabase } from "@/integrations/supabase/client";
import { toLocalYMD } from "@/lib/utils";

/**
 * Night Audit.
 *
 * Business date is stored as a single row in `app_settings` under key
 * `business_date` ({ date: "YYYY-MM-DD" }). We never advance the date
 * automatically until pending check-ins / check-outs are resolved.
 *
 * Pending check-ins  : status NOT IN (Checked-In, Checked-Out, Cancelled)
 *                      AND check_in <= business_date
 * Pending check-outs : status = Checked-In AND check_out <= business_date
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

function addDaysYMD(ymd: string, n: number): string {
  const d = new Date(ymd + "T00:00:00");
  d.setDate(d.getDate() + n);
  return toLocalYMD(d);
}

export async function getPendingForAudit(businessDate?: string): Promise<{
  businessDate: string;
  pendingCheckIns: PendingBooking[];
  pendingCheckOuts: PendingBooking[];
}> {
  const bd = businessDate ?? (await getBusinessDate());

  const [{ data: ci }, { data: co }, { data: rooms }] = await Promise.all([
    supabase.from("bookings" as any).select("id,booking_reference,guest_name,phone,check_in,check_out,status,room_id")
      .lte("check_in", bd)
      .not("status", "in", "(Checked-In,Checked-Out,Cancelled,Stay Completed)")
      .order("check_in", { ascending: true }),
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
  reason?: "pending_check_ins" | "pending_check_outs";
  pendingCheckIns?: number;
  pendingCheckOuts?: number;
  previousBusinessDate?: string;
  newBusinessDate?: string;
}

export async function performNightAudit(opts: { mode?: "manual" | "auto"; actorName?: string | null } = {}): Promise<PerformAuditResult> {
  const { data: { user } } = await supabase.auth.getUser();
  const bd = await getBusinessDate();
  const { pendingCheckIns, pendingCheckOuts } = await getPendingForAudit(bd);

  if (pendingCheckIns.length > 0) {
    return { ok: false, reason: "pending_check_ins", pendingCheckIns: pendingCheckIns.length, pendingCheckOuts: pendingCheckOuts.length, previousBusinessDate: bd };
  }
  if (pendingCheckOuts.length > 0) {
    return { ok: false, reason: "pending_check_outs", pendingCheckIns: 0, pendingCheckOuts: pendingCheckOuts.length, previousBusinessDate: bd };
  }

  const next = addDaysYMD(bd, 1);
  await setBusinessDate(next);

  await supabase.from("night_audit_runs" as any).insert({
    user_id: user?.id ?? null,
    actor_name: opts.actorName ?? user?.email ?? "system",
    mode: opts.mode ?? "manual",
    previous_business_date: bd,
    new_business_date: next,
    pending_check_ins_resolved: 0,
    pending_check_outs_resolved: 0,
    notes: null,
  } as any);

  return { ok: true, previousBusinessDate: bd, newBusinessDate: next };
}
