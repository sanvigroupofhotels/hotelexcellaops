import { supabase } from "@/integrations/supabase/client";
import type { BookingItemRow } from "@/lib/booking-items-api";

export interface BookingRoomAssignmentRow {
  id: string;
  booking_id: string;
  room_id: string;
  user_id: string;
  created_at: string;
}

export async function listAssignments(booking_id: string) {
  const { data, error } = await supabase
    .from("booking_room_assignments" as any)
    .select("*")
    .eq("booking_id", booking_id)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as BookingRoomAssignmentRow[];
}

export async function addAssignment(booking_id: string, room_id: string) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  const { error } = await supabase.from("booking_room_assignments" as any)
    .insert({ booking_id, room_id, user_id: user.id } as any);
  if (error) throw error;
  // Keep legacy bookings.room_id in sync (use the first assignment).
  const list = await listAssignments(booking_id);
  await supabase.from("bookings" as any).update({ room_id: list[0]?.room_id ?? null } as any).eq("id", booking_id);
}

export async function removeAssignment(booking_id: string, assignment_id: string) {
  const { error } = await supabase.from("booking_room_assignments" as any).delete().eq("id", assignment_id);
  if (error) throw error;
  const list = await listAssignments(booking_id);
  await supabase.from("bookings" as any).update({ room_id: list[0]?.room_id ?? null } as any).eq("id", booking_id);
}

/** Required rooms = sum of booking_items.rooms; falls back to 1 when no items. */
export function requiredRoomCount(items: { rooms?: number | null }[]): number {
  if (!items || items.length === 0) return 1;
  const sum = items.reduce((acc, it) => acc + Math.max(1, Number(it.rooms ?? 1)), 0);
  return Math.max(1, sum);
}

/**
 * Rebalance booking_items so their room_type labels match the desired mix.
 *
 * Strategy (pricing-preserving):
 *   - Expand each existing item with rooms=N into N "slots", each carrying
 *     all of that item's fields verbatim (rate, breakfast, extras, dates...).
 *   - Build a flat queue of types from the desired mix.
 *   - Assign each slot the next type in the queue, leaving its other fields
 *     intact. Per-slot rate is preserved → total subtotal is preserved.
 *   - Persist as one item per slot (rooms = 1). Position is regenerated.
 *
 * Does NOT touch: bookings.amount, taxes, charges, payments.
 */
export async function rebalanceBookingItemTypes(
  booking_id: string,
  desiredMix: Record<string, number>,
  existingItems: BookingItemRow[],
) {
  if (existingItems.length === 0) return;
  // Expand to slots
  const slots = existingItems
    .slice()
    .sort((a, b) => a.position - b.position)
    .flatMap((it) => {
      const n = Math.max(1, Number(it.rooms ?? 1));
      return Array.from({ length: n }, () => ({ ...it, rooms: 1 }));
    });
  // Build type queue
  const queue: string[] = [];
  for (const [t, n] of Object.entries(desiredMix)) {
    for (let i = 0; i < n; i++) queue.push(t);
  }
  // Pad with last-known type if mismatch
  while (queue.length < slots.length) queue.push(queue[queue.length - 1] ?? slots[0].room_type);
  // Relabel slots
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

/** Required count by type, summed across booking_items. */
export function requiredByType(items: { room_type?: string | null; rooms?: number | null }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const it of items) {
    const t = (it.room_type || "").trim();
    if (!t) continue;
    out[t] = (out[t] ?? 0) + Math.max(1, Number(it.rooms ?? 1));
  }
  return out;
}
