import { supabase } from "@/integrations/supabase/client";

export interface RoomRateRow {
  room_type: string;
  default_rate: number;
  weekday_rate: number | null;
  weekend_rate: number | null;
  updated_at: string;
}

export interface RateOverrideRow {
  id: string;
  room_type: string;
  date: string; // YYYY-MM-DD
  rate: number;
  note: string | null;
  created_at: string;
}

export async function listRoomRates(): Promise<RoomRateRow[]> {
  const { data, error } = await supabase.from("room_rates" as any).select("*").order("room_type");
  if (error) throw error;
  return (data ?? []) as unknown as RoomRateRow[];
}

export async function upsertRoomRate(input: {
  room_type: string;
  default_rate: number;
  weekday_rate: number | null;
  weekend_rate: number | null;
}) {
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase
    .from("room_rates" as any)
    .upsert({ ...input, updated_by: user?.id } as any, { onConflict: "room_type" });
  if (error) throw error;
}

export async function listRateOverrides(opts?: { from?: string; to?: string; room_type?: string }): Promise<RateOverrideRow[]> {
  let q = supabase.from("rate_overrides" as any).select("*");
  if (opts?.from) q = q.gte("date", opts.from);
  if (opts?.to) q = q.lte("date", opts.to);
  if (opts?.room_type) q = q.eq("room_type", opts.room_type);
  const { data, error } = await q.order("date");
  if (error) throw error;
  return (data ?? []) as unknown as RateOverrideRow[];
}

export async function upsertRateOverride(input: { room_type: string; date: string; rate: number; note?: string }) {
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase
    .from("rate_overrides" as any)
    .upsert({ ...input, created_by: user?.id } as any, { onConflict: "room_type,date" });
  if (error) throw error;
}

export async function deleteRateOverride(room_type: string, date: string) {
  const { error } = await supabase.from("rate_overrides" as any).delete().eq("room_type", room_type).eq("date", date);
  if (error) throw error;
}

/**
 * Bulk apply: writes one override per date in [from, to] (inclusive) for a single room_type.
 *
 * Uses pure string arithmetic on YYYY-MM-DD so timezone has zero effect on the
 * date list — a known-good approach that fixes the prior off-by-one where
 * `new Date("YYYY-MM-DD")` parsed as UTC could shift the produced keys.
 */
function addDaysISO(ymd: string, days: number): string {
  // Parse as UTC to avoid local-tz drift, then reformat.
  const [y, m, d] = ymd.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d) + days * 86400000;
  return toLocalYMD(new Date(t));
}

export async function bulkApplyOverrides(input: { room_type: string; from: string; to: string; rate: number; note?: string }) {
  const { data: { user } } = await supabase.auth.getUser();
  if (input.to < input.from) throw new Error("Invalid date range");
  const rows: any[] = [];
  for (let key = input.from; key <= input.to; key = addDaysISO(key, 1)) {
    rows.push({ room_type: input.room_type, date: key, rate: input.rate, note: input.note ?? null, created_by: user?.id });
  }
  if (rows.length === 0) return;
  const { error } = await supabase.from("rate_overrides" as any).upsert(rows, { onConflict: "room_type,date" });
  if (error) throw error;
}

