import { supabase } from "@/integrations/supabase/client";
import { toLocalYMD, localYMDOffset } from "@/lib/utils";
import { getRoomRate, type EarlyCheckInSlot, type LateCheckOutSlot, type PetSize } from "@/lib/mock-data";
import { lineSubtotal, nightsOf, type LineItem } from "@/components/line-items-editor";
import type { QuoteItemRow } from "@/lib/quote-items-api";

export interface BookingItemRow {
  id: string;
  booking_id: string;
  position: number;
  room_type: string;
  rooms: number;
  adults: number;
  children: number;
  check_in: string;
  check_out: string;
  nights: number;
  breakfast_included: boolean;
  extra_bed: number;
  rate: number;
  subtotal: number;
  notes: string | null;
  early_check_in: boolean;
  early_check_in_slot: EarlyCheckInSlot | null;
  late_check_out: boolean;
  late_check_out_slot: LateCheckOutSlot | null;
  pet_size: PetSize;
  extra_adults: number;
  drivers: number;
  assigned_room_id?: string | null;
  primary_occupant_name?: string | null;
  primary_phone?: string | null;
  item_status?: "Confirmed" | "Checked-In" | "Checked-Out" | "Cancelled" | "No-Show" | "Removed";
  removed_at?: string | null;
  removed_reason?: string | null;
  added_during_stay?: boolean;
  checked_in_at?: string | null;
  checked_out_at?: string | null;
  created_at: string;
  updated_at: string;
}

export type BookingItemInput = LineItem;

export function emptyBookingItem(): BookingItemInput {
  const today = toLocalYMD();
  const tomorrow = localYMDOffset(1);
  return {
    room_type: "Oak Room",
    rooms: 1,
    adults: 2,
    children: 0,
    check_in: today,
    check_out: tomorrow,
    breakfast_included: false,
    extra_bed: 0,
    rate: getRoomRate("Oak Room", false),
    early_check_in: false,
    early_check_in_slot: null,
    late_check_out: false,
    late_check_out_slot: null,
    pet_size: "none",
    extra_adults: 0,
    drivers: 0,
  };
}

export function computeNights(check_in: string, check_out: string) {
  return nightsOf({ check_in, check_out });
}

export function computeBookingItemSubtotal(item: BookingItemInput) {
  return lineSubtotal(item);
}

export function rowToLineItem(it: BookingItemRow): LineItem {
  return {
    room_type: it.room_type,
    rooms: it.rooms ?? 1,
    adults: it.adults,
    children: it.children,
    check_in: it.check_in,
    check_out: it.check_out,
    breakfast_included: it.breakfast_included,
    extra_bed: it.extra_bed,
    rate: Number(it.rate),
    early_check_in: it.early_check_in ?? false,
    early_check_in_slot: (it.early_check_in_slot ?? null) as EarlyCheckInSlot | null,
    late_check_out: it.late_check_out ?? false,
    late_check_out_slot: (it.late_check_out_slot ?? null) as LateCheckOutSlot | null,
    pet_size: (it.pet_size ?? "none") as PetSize,
    extra_adults: it.extra_adults ?? 0,
    drivers: it.drivers ?? 0,
    notes: it.notes ?? null,
  };
}

export async function listBookingItems(booking_id: string) {
  const { data, error } = await supabase
    .from("booking_items" as any)
    .select("*")
    .eq("booking_id", booking_id)
    .order("position", { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as BookingItemRow[];
}

export async function addBookingItems(booking_id: string, items: BookingItemInput[]) {
  if (items.length === 0) return [];
  let position = 0;
  // Guest distribution is owned by the Guest Allocation Engine — every
  // creation path (Quick / Detailed / Clone / quote → booking / API) reaches
  // `booking_items` through here, so per-room adults, children and derived
  // Extra Adults are always consistent with the room-type occupancy rules.
  const rows = items.flatMap((it) =>
    expandLineToRooms(it).map((perRoom) => ({
      booking_id,
      position: position++,
      room_type: perRoom.room_type,
      rooms: 1,
      adults: perRoom.adults,
      children: perRoom.children,
      check_in: perRoom.check_in,
      check_out: perRoom.check_out,
      breakfast_included: perRoom.breakfast_included,
      extra_bed: perRoom.extra_bed,
      rate: perRoom.rate,
      subtotal: computeBookingItemSubtotal(perRoom),
      notes: perRoom.notes ?? null,
      early_check_in: perRoom.early_check_in,
      early_check_in_slot: perRoom.early_check_in ? perRoom.early_check_in_slot : null,
      late_check_out: perRoom.late_check_out,
      late_check_out_slot: perRoom.late_check_out ? perRoom.late_check_out_slot : null,
      pet_size: perRoom.pet_size,
      extra_adults: perRoom.extra_adults,
      drivers: perRoom.drivers,
    })),
  );
  const { data, error } = await supabase.from("booking_items" as any).insert(rows as any).select();
  if (error) throw error;
  return (data ?? []) as unknown as BookingItemRow[];
}

export async function replaceBookingItems(booking_id: string, items: BookingItemInput[]) {
  await supabase.from("booking_items" as any).delete().eq("booking_id", booking_id);
  const created = await addBookingItems(booking_id, items);
  try {
    // Scoped to THIS booking only — the un-scoped variant rewrites item_status
    // for every booking in the property, silently reverting per-room check-ins
    // and check-outs made via the Room Management flows.
    await supabase.rpc("backfill_booking_item_segment_links_for_booking" as any, {
      p_booking_id: booking_id,
    });
  } catch {
    /* older deployments may not have the helper yet; assignment flows still work */
  }
  return created;
}

/** Convert quote items (snapshot) → booking item inputs. */
export function quoteItemsToBookingInputs(items: QuoteItemRow[]): BookingItemInput[] {
  return items.map((i) => ({
    room_type: i.room_type,
    rooms: i.rooms ?? 1,
    adults: i.adults,
    children: i.children,
    check_in: i.check_in,
    check_out: i.check_out,
    breakfast_included: i.breakfast_included,
    extra_bed: i.extra_bed,
    rate: Number(i.rate),
    early_check_in: i.early_check_in ?? false,
    early_check_in_slot: (i.early_check_in_slot ?? null) as EarlyCheckInSlot | null,
    late_check_out: i.late_check_out ?? false,
    late_check_out_slot: (i.late_check_out_slot ?? null) as LateCheckOutSlot | null,
    pet_size: (i.pet_size ?? "none") as PetSize,
    extra_adults: i.extra_adults ?? 0,
    drivers: i.drivers ?? 0,
    notes: i.notes ?? null,
  }));
}
