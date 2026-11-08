/**
 * Copilot booking updates. Reuses canonical engines only:
 * dates → updateBookingStay (past-date + inventory rules),
 * early/late → syncExpectedTimes (idempotent charge reconciliation),
 * totals → computePricing / refreshAfterBookingMutation.
 */
import type { QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { CopilotUpdate } from "@/lib/copilot.functions";
import { getBooking } from "@/lib/bookings-api";
import { listBookingItems, rowToLineItem, computeBookingItemSubtotal } from "@/lib/booking-items-api";
import { computePricing, DEFAULT_TAX_RATE } from "@/lib/pricing";
import { searchBookings, type BookingSearchResult } from "@/lib/booking-search";
import { updateBookingStay, humanizeStayError } from "@/lib/booking-stay";
import { syncExpectedTimes } from "@/lib/expected-time-charges";
import { refreshAfterBookingMutation } from "@/lib/booking-pricing-sync";
import { to12h, STANDARD_CHECK_IN, STANDARD_CHECK_OUT } from "@/lib/expected-times";

export type CopilotMatch = Pick<BookingSearchResult, "id" | "booking_reference" | "guest_name" | "phone" | "check_in" | "check_out" | "status" | "roomNumbers">;

export type CopilotUpdatePreview = {
  bookingId: string;
  label: string;
  guest_name: string;
  phone: string | null;
  changes: { label: string; from: string; to: string }[];
  update: CopilotUpdate;
  oldTotal: number;
  newTotal: number | null; // room total recalculated when rate changes
};

const CLOSED = ["Checked-Out", "Cancelled", "No-Show"];
const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

export function bookingLabel(b: { guest_name: string; booking_reference?: string | null; check_in: string; check_out: string }) {
  return `${b.guest_name}${b.booking_reference ? ` (${b.booking_reference})` : ""}, ${String(b.check_in).slice(0, 10)} → ${String(b.check_out).slice(0, 10)}`;
}

export async function findCopilotMatches(q: string): Promise<CopilotMatch[]> {
  const r = await searchBookings(q, { limit: 8 });
  return r.filter((b) => !CLOSED.includes(b.status));
}

export async function buildUpdatePreview(bookingId: string, u: CopilotUpdate): Promise<CopilotUpdatePreview> {
  const b: any = await getBooking(bookingId);
  if (!b) throw new Error("Booking not found");
  if (CLOSED.includes(b.status)) throw new Error(`This booking is ${b.status}; it can't be changed from chat.`);
  const rows = (await listBookingItems(bookingId)).filter((r) => (r.item_status ?? "") !== "Removed");
  const changes: CopilotUpdatePreview["changes"] = [];
  const ci = String(b.check_in).slice(0, 10), co = String(b.check_out).slice(0, 10);
  if (u.check_in && u.check_in !== ci) changes.push({ label: "Check-in", from: ci, to: u.check_in });
  if (u.check_out && u.check_out !== co) changes.push({ label: "Check-out", from: co, to: u.check_out });
  let newTotal: number | null = null;
  if (u.rate) {
    const cur = rows[0]?.rate ?? 0;
    changes.push({ label: "Rate / night", from: inr(cur), to: inr(u.rate) });
    const items = rows.map((r) => ({ ...rowToLineItem(r), rate: u.rate! }));
    const p = computePricing(items, Number(b.discount ?? 0) || 0, Number(b.tax_rate ?? DEFAULT_TAX_RATE) || DEFAULT_TAX_RATE, {
      totalOverride: null, taxesIncluded: !!b.taxes_included,
    });
    newTotal = p.total;
  }
  if (u.early_time) {
    if (u.early_time >= STANDARD_CHECK_IN) throw new Error(`Early check-in must be before ${to12h(STANDARD_CHECK_IN)}.`);
    changes.push({ label: "Early check-in", from: "Standard", to: `${to12h(u.early_time)} (charge as per tariff)` });
  }
  if (u.late_time) {
    if (u.late_time <= STANDARD_CHECK_OUT) throw new Error(`Late checkout must be after ${to12h(STANDARD_CHECK_OUT)}.`);
    changes.push({ label: "Late checkout", from: "Standard", to: `${to12h(u.late_time)} (charge as per tariff)` });
  }
  if (!changes.length) throw new Error("I didn't find anything to change. Tell me the new rate, time or date.");
  return { bookingId, label: bookingLabel(b), guest_name: b.guest_name, phone: b.phone ?? null, changes, update: u, oldTotal: Number(b.amount ?? 0), newTotal };
}

export async function applyCopilotUpdate(pv: CopilotUpdatePreview, qc: QueryClient) {
  const u = pv.update;
  const id = pv.bookingId;
  if (u.check_in || u.check_out) {
    try {
      await updateBookingStay({ booking_id: id, new_check_in: u.check_in ?? undefined, new_check_out: u.check_out ?? undefined, source: "manual", page: "copilot" });
    } catch (e) { throw new Error(humanizeStayError(e)); }
  }
  if (u.rate) {
    const rows = (await listBookingItems(id)).filter((r) => (r.item_status ?? "") !== "Removed");
    for (const r of rows) {
      const subtotal = computeBookingItemSubtotal({ ...rowToLineItem(r), rate: u.rate });
      const { error } = await supabase.from("booking_items" as any).update({ rate: u.rate, subtotal } as any).eq("id", r.id);
      if (error) throw error;
    }
    // Clear any manual total so the new nightly rate drives the total.
    await supabase.from("bookings" as any).update({ total_override: null } as any).eq("id", id);
  }
  if (u.early_time || u.late_time) {
    const rows = await listBookingItems(id);
    const first = rows[0];
    const ci = first?.check_in ?? u.check_in, co = first?.check_out ?? u.check_out;
    await syncExpectedTimes(id, {
      ...(u.early_time ? { expectedArrivalAt: new Date(`${ci}T${u.early_time}`).toISOString() } : {}),
      ...(u.late_time ? { expectedDepartureAt: new Date(`${co}T${u.late_time}`).toISOString() } : {}),
      syncEarly: !!u.early_time,
      syncLate: !!u.late_time,
    });
  }
  await refreshAfterBookingMutation(qc, id);
}

export type CopilotRecent = { id: string; booking_reference: string | null; guest_name: string; phone: string | null; check_in: string; check_out: string; status: string; amount: number; room_details: string | null };
/** Last 10 bookings for the Copilot "Recent" panel (caller-scoped read). */
export async function listRecentBookings(): Promise<CopilotRecent[]> {
  const { supabase } = await import("@/integrations/supabase/client");
  const { data, error } = await supabase.from("bookings").select("id, booking_reference, guest_name, phone, check_in, check_out, status, amount, room_details").order("created_at", { ascending: false }).limit(10);
  if (error) throw error;
  return (data ?? []) as any;
}
