import { supabase } from "@/integrations/supabase/client";

export const PAYMENT_MODES = ["Cash", "UPI", "Bank Transfer", "Card", "Hotelzify", "OTA"] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number] | string;

export interface BookingPaymentRow {
  id: string;
  user_id: string;
  booking_id: string;
  customer_id: string | null;
  amount: number;
  payment_mode: PaymentMode;
  collected_by: string;
  occurred_at: string;
  notes: string | null;
  is_refund?: boolean;
  refund_reason?: string | null;
  created_at: string;
  updated_at: string;
}

export interface BookingPaymentInput {
  booking_id: string;
  customer_id?: string | null;
  amount: number;
  payment_mode: PaymentMode;
  collected_by: string;
  occurred_at?: string;
  notes?: string | null;
  is_refund?: boolean;
  refund_reason?: string | null;
}

export async function listBookingPayments(booking_id: string) {
  const { data, error } = await supabase
    .from("booking_payments" as any)
    .select("*")
    .eq("booking_id", booking_id)
    .order("occurred_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as BookingPaymentRow[];
}

export async function createBookingPayment(input: BookingPaymentInput) {
  if (!(input.amount > 0)) throw new Error("Amount must be greater than zero");
  if (!input.payment_mode) throw new Error("Payment mode is required");
  if (!input.collected_by?.trim()) throw new Error("Collected by is required");
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  const row: any = {
    booking_id: input.booking_id,
    customer_id: input.customer_id ?? null,
    amount: input.amount,
    payment_mode: input.payment_mode,
    collected_by: input.collected_by.trim(),
    occurred_at: input.occurred_at ?? new Date().toISOString(),
    notes: input.notes ?? null,
    user_id: user.id,
  };
  const { data, error } = await supabase.from("booking_payments" as any).insert(row).select().single();
  if (error) throw error;
  return data as unknown as BookingPaymentRow;
}

export async function updateBookingPayment(id: string, patch: Partial<BookingPaymentInput>) {
  const row: any = { ...patch };
  if (patch.occurred_at) row.occurred_at = patch.occurred_at;
  const { data, error } = await supabase
    .from("booking_payments" as any).update(row).eq("id", id).select().single();
  if (error) throw error;
  return data as unknown as BookingPaymentRow;
}

export async function deleteBookingPayment(id: string) {
  const { error } = await supabase.from("booking_payments" as any).delete().eq("id", id);
  if (error) throw error;
}
