import { supabase } from "@/integrations/supabase/client";
import { buildBookingChargeRow, type BookingChargeInput } from "@/lib/booking-charge-row";

// Canonical builder/validator lives in a pure module; re-exported so existing
// imports of these symbols keep working.
export { buildBookingChargeRow };
export type { BookingChargeInput };

export interface BookingChargeRow {
  id: string;
  user_id: string;
  booking_id: string;
  item_id: string | null;
  category: string;
  other_description: string | null;
  quantity: number;
  unit_price: number;
  amount: number;
  /** System-calculated unit price before override. null = never auto-priced. */
  standard_unit_price: number | null;
  price_overridden: boolean;
  added_by: string | null;
  occurred_at: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}


export async function listBookingCharges(booking_id: string) {
  const { data, error } = await supabase
    .from("booking_charges" as any)
    .select("*")
    .eq("booking_id", booking_id)
    .order("occurred_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as BookingChargeRow[];
}

export async function createBookingCharge(input: BookingChargeInput) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  const row = buildBookingChargeRow(input, user.id);
  const { data, error } = await supabase
    .from("booking_charges" as any).insert(row as any).select().single();
  if (error) throw error;
  return data as unknown as BookingChargeRow;
}

export async function updateBookingCharge(id: string, patch: Partial<BookingChargeInput>) {
  const next: any = { ...patch };
  if (patch.quantity != null || patch.unit_price != null) {
    // recompute on the client only if both present, else server keeps current
  }
  if (patch.quantity != null && patch.unit_price != null) {
    next.amount = Number((patch.quantity * patch.unit_price).toFixed(2));
  }
  const { data, error } = await supabase
    .from("booking_charges" as any).update(next).eq("id", id).select().single();
  if (error) throw error;
  return data as unknown as BookingChargeRow;
}

export async function deleteBookingCharge(id: string) {
  const { error } = await supabase.from("booking_charges" as any).delete().eq("id", id);
  if (error) throw error;
}

export function chargesTotal(rows: BookingChargeRow[]): number {
  return rows.reduce((s, r) => s + Number(r.amount || 0), 0);
}

export async function listAllChargeTotals(): Promise<Record<string, number>> {
  const { data, error } = await supabase
    .from("booking_charges" as any)
    .select("booking_id, amount");
  if (error) throw error;
  const map: Record<string, number> = {};
  for (const r of (data ?? []) as any[]) {
    map[r.booking_id] = (map[r.booking_id] || 0) + Number(r.amount || 0);
  }
  return map;
}
