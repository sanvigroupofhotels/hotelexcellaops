import { supabase } from "@/integrations/supabase/client";
import { toLocalYMD, localYMDOffset } from "@/lib/utils";
import { getRoomRate, type EarlyCheckInSlot, type LateCheckOutSlot, type PetSize } from "@/lib/mock-data";
import {
  lineSubtotal,
  nightsOf,
  type LineItem,
} from "@/components/line-items-editor";

export interface QuoteItemRow {
  id: string;
  quote_id: string;
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
  created_at: string;
  updated_at: string;
}

export type QuoteItemInput = LineItem;

export function emptyLineItem(): QuoteItemInput {
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

export function computeItemSubtotal(item: QuoteItemInput) {
  return lineSubtotal(item);
}

/** Coerce a DB row → LineItem (filling defaults for older rows). */
export function rowToLineItem(it: QuoteItemRow): LineItem {
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

export async function listQuoteItems(quote_id: string) {
  const { data, error } = await supabase
    .from("quote_items" as any)
    .select("*")
    .eq("quote_id", quote_id)
    .order("position", { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as QuoteItemRow[];
}

function inputToRow(it: QuoteItemInput, idx: number, quote_id: string) {
  return {
    quote_id,
    position: idx,
    room_type: it.room_type,
    rooms: it.rooms,
    adults: it.adults,
    children: it.children,
    check_in: it.check_in,
    check_out: it.check_out,
    breakfast_included: it.breakfast_included,
    extra_bed: it.extra_bed,
    rate: it.rate,
    subtotal: computeItemSubtotal(it),
    notes: it.notes ?? null,
    early_check_in: it.early_check_in,
    early_check_in_slot: it.early_check_in ? it.early_check_in_slot : null,
    late_check_out: it.late_check_out,
    late_check_out_slot: it.late_check_out ? it.late_check_out_slot : null,
    pet_size: it.pet_size,
    extra_adults: it.extra_adults,
    drivers: it.drivers,
  };
}

export async function addQuoteItems(quote_id: string, items: QuoteItemInput[]) {
  if (items.length === 0) return [];
  const rows = items.map((it, idx) => inputToRow(it, idx, quote_id));
  const { data, error } = await supabase.from("quote_items" as any).insert(rows as any).select();
  if (error) throw error;
  return (data ?? []) as unknown as QuoteItemRow[];
}

export async function deleteQuoteItem(id: string) {
  const { error } = await supabase.from("quote_items" as any).delete().eq("id", id);
  if (error) throw error;
}

export async function replaceQuoteItems(quote_id: string, items: QuoteItemInput[]) {
  await supabase.from("quote_items" as any).delete().eq("quote_id", quote_id);
  return addQuoteItems(quote_id, items);
}
