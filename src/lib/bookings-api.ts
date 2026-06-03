import { supabase } from "@/integrations/supabase/client";
import type { BookingStatus } from "@/lib/mock-data";

export interface BookingRow {
  id: string;
  user_id: string;
  customer_id: string;
  source_quote_id: string | null;
  booking_reference: string;
  guest_name: string;
  phone: string | null;
  email: string | null;
  check_in: string;
  check_out: string;
  nights: number;
  adults: number;
  children: number;
  guests: number;
  room_details: string | null;
  amount: number;
  advance_paid: number;
  notes: string | null;
  internal_notes: string | null;
  status: BookingStatus;
  payment_status: string;
  created_at: string;
  updated_at: string;
}

export interface BookingInput {
  customer_id: string;
  source_quote_id?: string | null;
  guest_name: string;
  phone?: string | null;
  email?: string | null;
  check_in: string;
  check_out: string;
  adults: number;
  children: number;
  guests: number;
  room_details?: string | null;
  amount: number;
  advance_paid?: number;
  notes?: string | null;
  internal_notes?: string | null;
  status?: BookingStatus;
  payment_status?: string;
}

export function validateBookingInput(b: BookingInput) {
  if (!b.customer_id) throw new Error("Customer is required");
  if (!b.guest_name?.trim()) throw new Error("Guest name is required");
  if (!b.check_in || !b.check_out) throw new Error("Stay dates are required");
  if (new Date(b.check_out) <= new Date(b.check_in))
    throw new Error("Check-out must be after check-in");
  if (b.adults < 1) throw new Error("At least 1 adult is required");
  if (b.amount < 0) throw new Error("Amount cannot be negative");
  if ((b.advance_paid ?? 0) < 0) throw new Error("Advance paid cannot be negative");
  if ((b.advance_paid ?? 0) > b.amount) throw new Error("Advance paid cannot exceed total amount");
}

export async function listBookings() {
  const { data, error } = await supabase
    .from("bookings" as any).select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as BookingRow[];
}

export async function listCustomerBookings(customer_id: string) {
  const { data, error } = await supabase
    .from("bookings" as any).select("*").eq("customer_id", customer_id)
    .order("check_in", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as BookingRow[];
}

export async function getBooking(id: string) {
  const { data, error } = await supabase
    .from("bookings" as any).select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data as unknown as BookingRow | null;
}

export async function createBooking(input: BookingInput) {
  validateBookingInput(input);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  const row = {
    ...input,
    phone: input.phone ?? null,
    email: input.email ?? null,
    room_details: input.room_details ?? null,
    notes: input.notes ?? null,
    internal_notes: input.internal_notes ?? null,
    status: input.status ?? "Draft",
    payment_status: input.payment_status ?? "None",
    advance_paid: input.advance_paid ?? 0,
    user_id: user.id,
  };
  const { data, error } = await supabase
    .from("bookings" as any).insert(row as any).select().single();
  if (error) throw error;
  return data as unknown as BookingRow;
}

export async function updateBooking(id: string, patch: Partial<BookingInput>) {
  if (patch.check_in && patch.check_out && new Date(patch.check_out) <= new Date(patch.check_in))
    throw new Error("Check-out must be after check-in");
  const { data, error } = await supabase
    .from("bookings" as any).update(patch as any).eq("id", id).select().single();
  if (error) throw error;
  return data as unknown as BookingRow;
}

export async function setBookingStatus(id: string, status: BookingStatus) {
  const { error } = await supabase.from("bookings" as any).update({ status }).eq("id", id);
  if (error) throw error;
}

export async function setAdvancePaid(id: string, advance_paid: number) {
  const { error } = await supabase.from("bookings" as any).update({ advance_paid }).eq("id", id);
  if (error) throw error;
}

export async function deleteBooking(id: string) {
  const { error } = await supabase.from("bookings" as any).delete().eq("id", id);
  if (error) throw error;
}
