import { supabase } from "@/integrations/supabase/client";
import { getRoomRate } from "@/lib/mock-data";

export interface QuoteItemRow {
  id: string;
  quote_id: string;
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

export interface QuoteItemInput {
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

export function emptyLineItem(): QuoteItemInput {
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

export function computeItemSubtotal(item: QuoteItemInput) {
  const nights = computeNights(item.check_in, item.check_out);
  return Number(item.rate) * nights;
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

export async function addQuoteItems(quote_id: string, items: QuoteItemInput[]) {
  if (items.length === 0) return [];
  const rows = items.map((it, idx) => ({
    quote_id,
    position: idx,
    room_type: it.room_type,
    adults: it.adults,
    children: it.children,
    check_in: it.check_in,
    check_out: it.check_out,
    breakfast_included: it.breakfast_included,
    extra_bed: it.extra_bed,
    rate: it.rate,
    subtotal: computeItemSubtotal(it),
    notes: it.notes ?? null,
  }));
  const { data, error } = await supabase
    .from("quote_items" as any)
    .insert(rows as any)
    .select();
  if (error) throw error;
  return (data ?? []) as unknown as QuoteItemRow[];
}

export async function deleteQuoteItem(id: string) {
  const { error } = await supabase.from("quote_items" as any).delete().eq("id", id);
  if (error) throw error;
}

export async function replaceQuoteItems(quote_id: string, items: QuoteItemInput[]) {
  // delete then insert — simplest reliable reorder
  await supabase.from("quote_items" as any).delete().eq("quote_id", quote_id);
  return addQuoteItems(quote_id, items);
}
