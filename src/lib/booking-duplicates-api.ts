import { supabase } from "@/integrations/supabase/client";
import { addLocalDay } from "@/lib/room-type-availability-core";

/** Statuses that never count as an active stay for duplicate detection. */
export const INACTIVE_BOOKING_STATUSES = ["Cancelled", "No-Show", "Draft"] as const;

export interface DuplicateCheckInput {
  phone?: string | null;
  customerId?: string | null;
  checkIn: string;
  checkOut: string;
  excludeBookingId?: string | null;
}

export interface DuplicateBookingMatch {
  id: string;
  booking_reference: string | null;
  guest_name: string | null;
  phone: string | null;
  check_in: string;
  check_out: string;
  status: string | null;
  rooms: string[];
}

/** Last 10 digits of a phone number, or null when too short to compare. */
export function phoneKey(phone?: string | null): string | null {
  const d = (phone ?? "").replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : null;
}

/** Half-open date overlap: existing.in < req.out AND existing.out > req.in. */
export function staysOverlap(aIn: string, aOut: string, bIn: string, bOut: string): boolean {
  return aIn < (bIn === bOut ? addLocalDay(bIn) : bOut) && (aIn === aOut ? addLocalDay(aIn) : aOut) > bIn;
}

export function isActiveForDuplicates(status?: string | null): boolean {
  return !(INACTIVE_BOOKING_STATUSES as readonly string[]).includes(status ?? "");
}

/** Canonical duplicate lookup shared by every booking channel. */
export async function checkBookingDuplicates(input: DuplicateCheckInput): Promise<DuplicateBookingMatch[]> {
  const key = phoneKey(input.phone);
  if (!key && !input.customerId) return [];
  if (!input.checkIn || !input.checkOut) return [];
  const ors: string[] = [];
  if (key) ors.push(`phone.ilike.%${key}`);
  if (input.customerId) ors.push(`customer_id.eq.${input.customerId}`);
  let q = supabase
    .from("bookings" as any)
    .select("id, booking_reference, guest_name, phone, check_in, check_out, status, booking_room_assignments ( rooms ( room_number ) )")
    .or(ors.join(","))
    .lt("check_in", input.checkIn === input.checkOut ? addLocalDay(input.checkIn) : input.checkOut)
    .gte("check_out", input.checkIn)
    .limit(10);
  if (input.excludeBookingId) q = q.neq("id", input.excludeBookingId);
  const { data, error } = await q;
  if (error) throw error;
  return ((data ?? []) as any[])
    .filter((b) => isActiveForDuplicates(b.status))
    .filter((b) => staysOverlap(b.check_in, b.check_out, input.checkIn, input.checkOut))
    .map((b) => ({
      id: b.id,
      booking_reference: b.booking_reference ?? null,
      guest_name: b.guest_name ?? null,
      phone: b.phone ?? null,
      check_in: b.check_in,
      check_out: b.check_out,
      status: b.status ?? null,
      rooms: ((b.booking_room_assignments ?? []) as any[]).map((a) => a?.rooms?.room_number).filter(Boolean),
    }));
}
