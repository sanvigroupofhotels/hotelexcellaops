/**
 * Copilot stay & billing ops. Thin previews over canonical HEOS engines only:
 * check-in → addAssignment + checkInBookingItem, check-out → validateCheckout +
 * checkOutBookingItem, payments → createBookingPayment. No parallel logic.
 */
import type { QueryClient } from "@tanstack/react-query";
import { getBooking } from "@/lib/bookings-api";
import { listBookingItems } from "@/lib/booking-items-api";
import { listAvailableRoomsForStay } from "@/lib/room-availability";
import { addAssignment } from "@/lib/booking-room-assignments-api";
import { checkInBookingItem, checkOutBookingItem } from "@/lib/booking-item-operations-api";
import { validateCheckout } from "@/lib/checkout-validation";
import { createBookingPayment } from "@/lib/booking-payments-api";
import { refreshAfterBookingMutation } from "@/lib/booking-pricing-sync";
import { bookingLabel } from "@/lib/copilot-update";
import { supabase } from "@/integrations/supabase/client";

export type CopilotRoomOpt = { id: string; room_number: string };
export type CopilotStayItem = { id: string; room_type: string; roomId: string | null; roomNumber: string | null; options: CopilotRoomOpt[] };
export type CopilotStayOp =
  | { kind: "check_in"; bookingId: string; label: string; guest_name: string; items: CopilotStayItem[]; docsPending: boolean }
  | { kind: "check_out"; bookingId: string; label: string; guest_name: string; itemIds: string[]; rooms: string[]; balance: number; blocker: string | null }
  | { kind: "payment"; bookingId: string; label: string; guest_name: string; customer_id: string | null; amount: number; mode: string; utr: string; balance: number };

const ymd = (v: any) => String(v ?? "").slice(0, 10);

async function base(bookingId: string) {
  const b: any = await getBooking(bookingId);
  if (!b) throw new Error("Booking not found");
  const rows = (await listBookingItems(bookingId)).filter((r: any) => !["Removed", "Cancelled", "No-Show"].includes(r.item_status ?? ""));
  return { b, rows: rows as any[] };
}

async function roomNumbers(ids: string[]) {
  if (!ids.length) return new Map<string, string>();
  const { data } = await supabase.from("rooms").select("id, room_number").in("id", ids);
  return new Map(((data ?? []) as any[]).map((r) => [r.id, r.room_number]));
}

export async function buildCheckInPreview(bookingId: string): Promise<CopilotStayOp> {
  const { b, rows } = await base(bookingId);
  if (["Checked-Out", "Cancelled", "No-Show"].includes(b.status)) throw new Error(`This booking is ${b.status}.`);
  const todo = rows.filter((r) => (r.item_status ?? "Confirmed") === "Confirmed");
  if (!todo.length) throw new Error(`${b.guest_name} is already checked in.`);
  const nums = await roomNumbers(todo.map((r) => r.assigned_room_id).filter(Boolean));
  const ci = ymd(b.check_in), co = ymd(b.check_out);
  const free = await listAvailableRoomsForStay({ check_in: ci, check_out: co > ci ? co : ci, exclude_booking_id: bookingId });
  let hk = new Map<string, string>();
  if (free.length) {
    const { data } = await supabase.from("rooms" as any).select("id, housekeeping_status").in("id", free.map((r) => r.id));
    hk = new Map(((data ?? []) as any[]).map((r) => [r.id, String(r.housekeeping_status ?? "")]));
  }
  const isClean = (id: string) => !/dirty|service|out/i.test(hk.get(id) ?? "");
  const items: CopilotStayItem[] = todo.map((r) => ({
    id: r.id, room_type: r.room_type, roomId: r.assigned_room_id ?? null, roomNumber: r.assigned_room_id ? nums.get(r.assigned_room_id) ?? null : null,
    options: r.assigned_room_id ? [] : free.filter((f) => f.room_type === r.room_type && isClean(f.id)).slice(0, 8).map((f) => ({ id: f.id, room_number: f.room_number })),
  }));
  const { listGuestDocuments } = await import("@/lib/guest-documents-api");
  const docs = await listGuestDocuments(bookingId);
  return { kind: "check_in", bookingId, label: bookingLabel(b), guest_name: b.guest_name, items, docsPending: docs.length === 0 };
}

export async function buildCheckOutPreview(bookingId: string): Promise<CopilotStayOp> {
  const { b, rows } = await base(bookingId);
  const inHouse = rows.filter((r) => r.item_status === "Checked-In");
  if (!inHouse.length) throw new Error(`${b.guest_name} is not checked in.`);
  const nums = await roomNumbers(inHouse.map((r) => r.assigned_room_id).filter(Boolean));
  const v = await validateCheckout(bookingId);
  const over = v.blockers.find((x) => x.code === "overpayment");
  return { kind: "check_out", bookingId, label: bookingLabel(b), guest_name: b.guest_name, itemIds: inHouse.map((r) => r.id),
    rooms: inHouse.map((r) => nums.get(r.assigned_room_id) ?? "—"), balance: Math.max(0, Math.round(v.balance)), blocker: over?.message ?? null };
}

export async function buildPaymentPreview(bookingId: string, amount: number | null, mode: string | null, utr: string | null): Promise<CopilotStayOp> {
  const { b } = await base(bookingId);
  const v = await validateCheckout(bookingId);
  const balance = Math.max(0, Math.round(v.balance));
  return { kind: "payment", bookingId, label: bookingLabel(b), guest_name: b.guest_name, customer_id: b.customer_id ?? null,
    amount: amount && amount > 0 ? amount : balance, mode: mode || "Cash", utr: utr ?? "", balance };
}

/** Executes through canonical engines; RLS and engine guards apply as the signed-in user. */
export async function executeStayOp(op: CopilotStayOp, opts: { collectedBy: string; rooms?: Record<string, string>; overrideDocs?: boolean; settleMode?: string }, qc: QueryClient) {
  if (op.kind === "check_in") {
    for (const it of op.items) {
      const roomId = it.roomId ?? opts.rooms?.[it.id];
      if (!roomId) throw new Error(`Pick a room for the ${it.room_type}.`);
      if (!it.roomId) await addAssignment(op.bookingId, roomId, { item_id: it.id });
      await checkInBookingItem(it.id, { allowOverride: !!opts.overrideDocs });
    }
  } else if (op.kind === "check_out") {
    if (op.balance > 0) {
      if (!opts.settleMode) throw new Error(`Balance ₹${op.balance} is due. Pick a payment mode to settle.`);
      const { data: bk } = await supabase.from("bookings").select("customer_id").eq("id", op.bookingId).maybeSingle();
      await createBookingPayment({ booking_id: op.bookingId, customer_id: (bk as any)?.customer_id ?? null, amount: op.balance, payment_mode: opts.settleMode, collected_by: opts.collectedBy, notes: "Settled at checkout via Copilot" });
    }
    for (const id of op.itemIds) await checkOutBookingItem(id);
  } else {
    await createBookingPayment({ booking_id: op.bookingId, customer_id: op.customer_id, amount: op.amount, payment_mode: op.mode, collected_by: opts.collectedBy, utr: op.utr || null, notes: "Recorded via Copilot" });
  }
  await refreshAfterBookingMutation(qc, op.bookingId);
  qc.invalidateQueries();
}
