/**
 * Shared "Currently In-House" query
 * ---------------------------------
 * Single operational definition of which Booking Items are in-house right now
 * (i.e. the guest is physically present). Every screen that needs this list —
 * Dashboard (Add Charge / Add Payment / Check-Out pickers), House View filters,
 * Front Desk arrivals/departures, reporting — MUST consume this engine rather
 * than roll its own filter.
 *
 * Definition:
 *   A Booking Item is "in-house" when:
 *     • Its parent booking is not Cancelled / No-Show / Checked-Out; AND
 *     • Its `item_status = 'Checked-In'`; OR (legacy fallback) the parent
 *       booking status is 'Checked-In' and no item-level statuses exist.
 *
 * Room number resolution walks the active `booking_room_assignments` segment
 * that covers the current business date. Multi-room bookings surface one row
 * per operational room.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toLocalYMD } from "@/lib/utils";

export type InHouseItem = {
  bookingId: string;
  itemId: string;
  roomId: string | null;
  roomNumber: string | null;
  roomType: string | null;
  primaryOccupant: string | null;
  guestName: string;
  booking: any;
  item: any;
};

const IN_HOUSE_BOOKING_STATUSES = new Set(["Checked-In"]);

export async function listInHouseItems(): Promise<InHouseItem[]> {
  const today = toLocalYMD();

  const { data: bookings, error: bErr } = await supabase
    .from("bookings")
    .select("id, guest_name, phone, status, check_in, check_out, amount, advance_paid, customer_id")
    .in("status", ["Checked-In"] as const);
  if (bErr) throw bErr;
  const bookingIds = (bookings ?? []).map((b: any) => b.id);
  if (bookingIds.length === 0) return [];

  const { data: items, error: iErr } = await supabase
    .from("booking_items" as any)
    .select("id, booking_id, position, room_type, assigned_room_id, primary_occupant_name, item_status, check_in, check_out")
    .in("booking_id", bookingIds);
  if (iErr) throw iErr;

  const { data: assignments, error: aErr } = await supabase
    .from("booking_room_assignments" as any)
    .select("id, booking_id, item_id, room_id, start_date, end_date, ended_reason")
    .in("booking_id", bookingIds);
  if (aErr) throw aErr;

  const { data: rooms, error: rErr } = await supabase
    .from("rooms")
    .select("id, room_number, room_type");
  if (rErr) throw rErr;
  const roomById = new Map<string, any>();
  for (const r of (rooms ?? []) as any[]) roomById.set(r.id, r);

  const bookingById = new Map<string, any>();
  for (const b of (bookings ?? []) as any[]) bookingById.set(b.id, b);

  const itemsByBooking = new Map<string, any[]>();
  for (const it of (items ?? []) as any[]) {
    const arr = itemsByBooking.get(it.booking_id) ?? [];
    arr.push(it);
    itemsByBooking.set(it.booking_id, arr);
  }
  const assignmentsByItem = new Map<string, any[]>();
  for (const a of (assignments ?? []) as any[]) {
    if (!a.item_id) continue;
    const arr = assignmentsByItem.get(a.item_id) ?? [];
    arr.push(a);
    assignmentsByItem.set(a.item_id, arr);
  }

  const result: InHouseItem[] = [];
  for (const booking of (bookings ?? []) as any[]) {
    const itemList = itemsByBooking.get(booking.id) ?? [];
    const anyItemStatus = itemList.some((it: any) => (it.item_status ?? null) !== null);

    // Legacy fallback: booking is Checked-In but items don't carry statuses.
    // Surface every item so downstream pickers still work.
    const inHouseItems = anyItemStatus
      ? itemList.filter((it: any) => it.item_status === "Checked-In")
      : itemList;

    for (const item of inHouseItems) {
      // Find active assignment segment covering today.
      const segs = assignmentsByItem.get(item.id) ?? [];
      const active = segs.find((a: any) => {
        if (a.ended_reason) return false;
        const startOk = !a.start_date || a.start_date <= today;
        const endOk = !a.end_date || a.end_date > today;
        return startOk && endOk;
      });
      const roomId = (active?.room_id as string | undefined) ?? (item.assigned_room_id as string | null) ?? null;
      const room = roomId ? roomById.get(roomId) : null;
      result.push({
        bookingId: booking.id,
        itemId: item.id,
        roomId,
        roomNumber: room?.room_number ?? null,
        roomType: item.room_type ?? room?.room_type ?? null,
        primaryOccupant: item.primary_occupant_name ?? null,
        guestName: item.primary_occupant_name || booking.guest_name || "Guest",
        booking,
        item,
      });
    }
  }

  // Sort by room number (natural) so pickers are deterministic across surfaces.
  result.sort((a, b) => {
    const an = a.roomNumber ?? "\uffff";
    const bn = b.roomNumber ?? "\uffff";
    return an.localeCompare(bn, undefined, { numeric: true });
  });
  return result;
}

export function useInHouseItems() {
  return useQuery({
    queryKey: ["in-house-items"],
    queryFn: listInHouseItems,
    staleTime: 30 * 1000,
  });
}
