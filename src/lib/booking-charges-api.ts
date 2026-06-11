import { supabase } from "@/integrations/supabase/client";

export interface BookingChargeRow {
  id: string;
  user_id: string;
  booking_id: string;
  category: string;
  other_description: string | null;
  quantity: number;
  unit_price: number;
  amount: number;
  added_by: string | null;
  occurred_at: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface BookingChargeInput {
  booking_id: string;
  category: string;
  other_description?: string | null;
  quantity: number;
  unit_price: number;
  added_by?: string | null;
  occurred_at?: string;
  notes?: string | null;
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
  if (!input.category) throw new Error("Category is required");
  if (input.category === "Other" && !input.other_description?.trim())
    throw new Error("Description is required for 'Other'");
  if (!(input.quantity > 0)) throw new Error("Quantity must be greater than zero");
  if (input.unit_price < 0) throw new Error("Unit price cannot be negative");
  const amount = Number((input.quantity * input.unit_price).toFixed(2));
  const row: any = {
    ...input,
    amount,
    user_id: user.id,
    occurred_at: input.occurred_at ?? new Date().toISOString(),
  };
  const { data, error } = await supabase
    .from("booking_charges" as any).insert(row).select().single();
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
