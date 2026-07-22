import { supabase } from "@/integrations/supabase/client";
import { onBookingRoomMoved } from "@/lib/hk-checkout-hook";
import { getBusinessDate } from "@/lib/night-audit-api";
import type { BookingItemRow } from "@/lib/booking-items-api";

/**
 * Booking Room Assignments — segmented occupancy.
 *
 * UAT-047: each row is a date-bounded segment `[start_date, end_date)` of the
 * booking's stay window. Mid-stay room changes close the old segment on the
 * business date and open a new segment on the new room. This preserves
 * historical occupancy across House View, Booking Detail, Housekeeping and
 * reports.
 *
 * `booking_room_assignments` is the SINGLE SOURCE OF TRUTH for room occupancy
 * history. Do not derive occupancy from `bookings.room_id` elsewhere — that
 * column is a compatibility shortcut for the CURRENT room only.
 */
export interface BookingRoomAssignmentRow {
  id: string;
  booking_id: string;
  room_id: string;
  user_id: string;
  created_at: string;
  start_date: string; // inclusive YYYY-MM-DD
  end_date: string;   // exclusive YYYY-MM-DD
  ended_reason: string | null;
}

const SEG_COLS = "id,booking_id,room_id,user_id,created_at,start_date,end_date,ended_reason";

export async function listAssignments(booking_id: string) {
  const { data, error } = await supabase
    .from("booking_room_assignments" as any)
    .select(SEG_COLS)
    .eq("booking_id", booking_id)
    .order("start_date", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as BookingRoomAssignmentRow[];
}

/** Segments that cover a specific date (start_date <= date < end_date). */
export async function listAssignmentsCoveringDate(booking_id: string, date: string) {
  const list = await listAssignments(booking_id);
  return list.filter((a) => a.start_date <= date && date < a.end_date);
}

/**
 * Assign a room. Segment defaults to the booking's full stay window.
 * When the booking already has assignments, the new segment starts where
 * the last one ended so multi-room bookings still tile cleanly.
 */
export async function addAssignment(
  booking_id: string,
  room_id: string,
  opts?: { start_date?: string; end_date?: string },
) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");

  let start_date = opts?.start_date;
  let end_date = opts?.end_date;
  if (!start_date || !end_date) {
    const { data: b, error: bErr } = await supabase
      .from("bookings" as any)
      .select("check_in,check_out")
      .eq("id", booking_id)
      .single();
    if (bErr) throw bErr;
    const ci = (b as any).check_in as string;
    const co = (b as any).check_out as string;
    // Day-use: give the segment at least one day so it's visible / occupies.
    const effectiveOut = ci === co ? addOneDay(ci) : co;
    start_date = start_date ?? ci;
    end_date = end_date ?? effectiveOut;
  }

  const { error } = await supabase.from("booking_room_assignments" as any)
    .insert({ booking_id, room_id, user_id: user.id, start_date, end_date } as any);
  if (error) throw error;

  await syncLegacyBookingRoom(booking_id);
}

export async function removeAssignment(booking_id: string, assignment_id: string) {
  const { error } = await supabase.from("booking_room_assignments" as any).delete().eq("id", assignment_id);
  if (error) throw error;
  await syncLegacyBookingRoom(booking_id);
}

/**
 * Mid-stay room change: splits the current segment on the business date and
 * opens a new segment on the new room. Server-side RPC keeps the operation
 * atomic and computes the effective date from `app_settings.business_date`.
 */
export async function splitAssignment(
  booking_id: string,
  old_assignment_id: string,
  new_room_id: string,
  effective_date?: string | null,
) {
  const { error } = await supabase.rpc("split_room_assignment" as any, {
    p_booking_id: booking_id,
    p_old_assignment_id: old_assignment_id,
    p_new_room_id: new_room_id,
    p_effective_date: effective_date ?? null,
  } as any);
  if (error) throw error;
}

/** Keep legacy `bookings.room_id` pointed at the segment covering today. */
async function syncLegacyBookingRoom(booking_id: string) {
  const list = await listAssignments(booking_id);
  const today = new Date().toISOString().slice(0, 10);
  const active = list.find((a) => a.start_date <= today && today < a.end_date) ?? list[0];
  await supabase.from("bookings" as any)
    .update({ room_id: active?.room_id ?? null } as any)
    .eq("id", booking_id);
}

function addOneDay(ymd: string) {
  const d = new Date(ymd + "T00:00:00");
  d.setDate(d.getDate() + 1);
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Required rooms = sum of booking_items.rooms; falls back to 1 when no items. */
export function requiredRoomCount(items: { rooms?: number | null }[]): number {
  if (!items || items.length === 0) return 1;
  const sum = items.reduce((acc, it) => acc + Math.max(1, Number(it.rooms ?? 1)), 0);
  return Math.max(1, sum);
}

/**
 * Rebalance booking_items so their room_type labels match the desired mix.
 * See original documentation — behaviour unchanged.
 */
export async function rebalanceBookingItemTypes(
  booking_id: string,
  desiredMix: Record<string, number>,
  existingItems: BookingItemRow[],
) {
  if (existingItems.length === 0) return;
  const slots = existingItems
    .slice()
    .sort((a, b) => a.position - b.position)
    .flatMap((it) => {
      const n = Math.max(1, Number(it.rooms ?? 1));
      return Array.from({ length: n }, () => ({ ...it, rooms: 1 }));
    });
  const queue: string[] = [];
  for (const [t, n] of Object.entries(desiredMix)) {
    for (let i = 0; i < n; i++) queue.push(t);
  }
  while (queue.length < slots.length) queue.push(queue[queue.length - 1] ?? slots[0].room_type);
  const rows = slots.map((s, idx) => ({
    booking_id,
    position: idx,
    room_type: queue[idx],
    rooms: 1,
    adults: s.adults,
    children: s.children,
    check_in: s.check_in,
    check_out: s.check_out,
    breakfast_included: s.breakfast_included,
    extra_bed: s.extra_bed,
    rate: Number(s.rate),
    subtotal: Number(s.subtotal) / Math.max(1, Number(s.rooms ?? 1)),
    notes: s.notes,
    early_check_in: s.early_check_in,
    early_check_in_slot: s.early_check_in_slot,
    late_check_out: s.late_check_out,
    late_check_out_slot: s.late_check_out_slot,
    pet_size: s.pet_size,
    extra_adults: s.extra_adults,
    drivers: s.drivers,
  }));
  const { error: delErr } = await supabase
    .from("booking_items" as any).delete().eq("booking_id", booking_id);
  if (delErr) throw delErr;
  const { error: insErr } = await supabase
    .from("booking_items" as any).insert(rows as any);
  if (insErr) throw insErr;
}

/** Normalize a room type label so "Oak" == "Oak Room" == "oak  room ". */
export function normalizeRoomType(t?: string | null): string {
  return (t || "")
    .toLowerCase()
    .replace(/\s+room\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Required count by normalized type, summed across booking_items. */
export function requiredByType(items: { room_type?: string | null; rooms?: number | null }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const it of items) {
    const t = normalizeRoomType(it.room_type);
    if (!t) continue;
    out[t] = (out[t] ?? 0) + Math.max(1, Number(it.rooms ?? 1));
  }
  return out;
}
