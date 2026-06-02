import { supabase } from "@/integrations/supabase/client";
import { getRoomRate } from "@/lib/mock-data";
import type { QuoteItemRow, QuoteItemInput } from "@/lib/quote-items-api";

export interface BookingItemRow {
  id: string;
  booking_id: string;
  position: number;
  room_type: string;
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
  created_at: string;
  updated_at: string;
}

export interface BookingItemInput {
  room_type: string;
  adults: number;
  children: number;
  check_in: string;
  check_out: string;
  breakfast_included: boolean;
  extra_bed: number;
  rate: number;
  notes?: string | null;
}

export function emptyBookingItem(): BookingItemInput {
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  return {
    room_type: "Oak Room",
    adults: 2,
    children: 0,
    check_in: today,
    check_out: tomorrow,
    breakfast_included: true,
    extra_bed: 0,
    rate: getRoomRate("Oak Room", true),
  };
}

export function computeNights(check_in: string, check_out: string) {
  return Math.max(
    1,
    Math.round((new Date(check_out).getTime() - new Date(check_in).getTime()) / 86400000),
  );
}

export function computeBookingItemSubtotal(item: BookingItemInput) {
  return Number(item.rate) * computeNights(item.check_in, item.check_out);
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
  const rows = items.map((it, idx) => ({
    booking_id,
    position: idx,
    room_type: it.room_type,
    adults: it.adults,
    children: it.children,
    check_in: it.check_in,
    check_out: it.check_out,
    breakfast_included: it.breakfast_included,
    extra_bed: it.extra_bed,
    rate: it.rate,
    subtotal: computeBookingItemSubtotal(it),
    notes: it.notes ?? null,
  }));
  const { data, error } = await supabase
    .from("booking_items" as any)
    .insert(rows as any)
    .select();
  if (error) throw error;
  return (data ?? []) as unknown as BookingItemRow[];
}

/** Convert quote items (snapshot) → booking item inputs. */
export function quoteItemsToBookingInputs(items: QuoteItemRow[] | QuoteItemInput[]): BookingItemInput[] {
  return items.map((i) => ({
    room_type: i.room_type,
    adults: i.adults,
    children: i.children,
    check_in: i.check_in,
    check_out: i.check_out,
    breakfast_included: i.breakfast_included,
    extra_bed: i.extra_bed,
    rate: Number(i.rate),
    notes: i.notes ?? null,
  }));
}
