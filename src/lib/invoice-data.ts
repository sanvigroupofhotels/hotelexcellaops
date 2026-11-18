import type { Db } from "@/lib/db";
import type { BookingRow } from "@/lib/bookings-api";
import type { BookingItemRow } from "@/lib/booking-items-api";
import type { BookingPaymentRow } from "@/lib/booking-payments-api";
import type { BookingChargeRow } from "@/lib/booking-charges-api";
import type { InvoiceBilling } from "@/lib/invoice-billing";
import { resolveBranding } from "@/lib/branding";
import { formatHotelTime } from "@/lib/time-format";

/** One caller-scoped read for all invoice surfaces; callers authorize first. */
export async function loadInvoiceData(client: Db, bookingId: string) {
  const results = await Promise.all([
    client.from("bookings").select("*").eq("id", bookingId).maybeSingle(),
    client.from("booking_items" as any).select("*").eq("booking_id", bookingId).order("position"),
    client.from("booking_payments" as any).select("*").eq("booking_id", bookingId).order("occurred_at"),
    client.from("booking_charges" as any).select("*").eq("booking_id", bookingId).order("created_at"),
    client.from("app_settings" as any).select("key,value").in("key", ["hotel", "branding", "ops"]),
    client.from("booking_room_assignments" as any).select("booking_item_id,room_id,rooms(room_number)").eq("booking_id", bookingId),
  ]);
  for (const result of results) if (result.error) throw result.error;
  const booking = results[0].data as unknown as BookingRow | null;
  if (!booking) throw new Error("Booking not found or unavailable.");
  const items = (results[1].data ?? []) as unknown as BookingItemRow[];
  const assignedIds = [...new Set(items.map((i) => i.assigned_room_id).filter((id): id is string => !!id))];
  const [customer, rooms] = await Promise.all([
    booking.customer_id
      ? client.from("customers" as any).select("company_name,gst_number,company_address").eq("id", booking.customer_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    assignedIds.length
      ? client.from("rooms").select("id,room_number").in("id", assignedIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (customer.error) throw customer.error;
  if (rooms.error) throw rooms.error;
  const roomById = new Map((rooms.data ?? []).map((r) => [r.id, r.room_number]));
  const roomLabels: Record<string, string> = {};
  for (const item of items) {
    const labels = (results[5].data ?? [] as any[])
      .filter((a: any) => a.booking_item_id === item.id)
      .map((a: any) => a.rooms?.room_number).filter(Boolean);
    const assigned = item.assigned_room_id ? roomById.get(item.assigned_room_id) : null;
    if (assigned) labels.unshift(assigned);
    roomLabels[item.id] = [...new Set(labels)].join(", ");
  }
  const settings = new Map((results[4].data ?? []).map((r: any) => [r.key, r.value]));
  const ops = (settings.get("ops") ?? {}) as Record<string, unknown>;
  return {
    booking, items,
    payments: (results[2].data ?? []) as unknown as BookingPaymentRow[],
    charges: (results[3].data ?? []) as unknown as BookingChargeRow[],
    branding: resolveBranding(settings.get("branding"), settings.get("hotel")),
    billing: customer.data as unknown as InvoiceBilling | null,
    roomLabels,
    checkInTime: formatHotelTime(typeof ops.check_in_time === "string" ? ops.check_in_time : "13:00"),
    checkOutTime: formatHotelTime(typeof ops.check_out_time === "string" ? ops.check_out_time : "11:00"),
  };
}