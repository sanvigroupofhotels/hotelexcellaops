/**
 * BOOKING ITEM LIFECYCLE — shared derivation engine.
 *
 * Every physical room on a booking is an independent Booking Item with its own
 * lifecycle (Confirmed → Checked-In → Checked-Out, plus Cancelled / No-Show /
 * Removed). The PARENT booking status is *derived* from those items — it is
 * never an independent source of truth.
 *
 * Rules (pure, unit-tested in tests/booking-item-lifecycle.test.ts):
 *   • Any item still Checked-In  → booking is Checked-In (partial departure
 *     keeps the booking operationally active).
 *   • No live item left and at least one departed → booking is Checked-Out.
 *   • Every item Cancelled / No-Show / Removed → that terminal status.
 *   • Otherwise (all Confirmed) → leave the pre-arrival status untouched
 *     (Draft / Pending / Confirmed / Advance Paid / Full Paid all mean
 *     "not arrived yet" and are owned by the payment engine).
 *
 * Nothing in this module touches occupancy segments; segment trimming stays in
 * `booking-item-operations-api.ts` (see docs/room-occupancy.md).
 */
import { supabase } from "@/integrations/supabase/client";

export const ITEM_DEPARTED = new Set(["Checked-Out"]);
export const ITEM_IGNORED = new Set(["Removed", "Cancelled", "No-Show"]);

export interface LifecycleItem {
  item_status?: string | null;
}

/**
 * Derive the parent booking status from its items.
 * Returns `null` when the current booking status must be preserved.
 */
export function deriveBookingStatusFromItems(
  items: LifecycleItem[],
  currentStatus: string,
): string | null {
  if (!items.length) return null;
  const statuses = items.map((i) => String(i.item_status ?? "Confirmed"));

  if (statuses.every((s) => s === "Cancelled")) return "Cancelled";
  if (statuses.every((s) => s === "No-Show")) return "No-Show";

  const operational = statuses.filter((s) => !ITEM_IGNORED.has(s) && s !== "Removed");
  if (operational.length === 0) return null;

  if (operational.some((s) => s === "Checked-In")) return "Checked-In";
  if (operational.every((s) => ITEM_DEPARTED.has(s))) {
    // Keep an already-closed booking closed rather than reopening it.
    return currentStatus === "Stay Completed" ? "Stay Completed" : "Checked-Out";
  }
  // Mixed Confirmed + Checked-Out (partial departure before any check-in was
  // recorded, or a reverted check-in) — the booking is still live.
  if (operational.some((s) => ITEM_DEPARTED.has(s))) return "Checked-In";
  return null;
}

/** Item statuses to write when the whole booking moves to a status. */
export function itemStatusForBookingStatus(status: string): string | null {
  switch (status) {
    case "Checked-In":
      return "Checked-In";
    case "Checked-Out":
    case "Stay Completed":
      return "Checked-Out";
    case "Cancelled":
      return "Cancelled";
    case "No-Show":
      return "No-Show";
    default:
      return null;
  }
}

/**
 * While a booking-level fan-out is running, per-item actions must NOT re-derive
 * the parent status: the parent was just written by the caller and the loop is
 * mid-flight, so an intermediate derivation would flap the booking between
 * Checked-In and Checked-Out. The fan-out re-derives once when it finishes.
 */
let fanOutDepth = 0;

/**
 * Recompute the parent booking status from its items and persist it when it
 * changed. Called after every per-item lifecycle action so a partial check-in
 * or partial departure never leaves booking/item state inconsistent.
 *
 * Bidirectional sync contract (Room Management → Booking Detail → House View):
 * the parent booking is only Checked-Out once EVERY applicable room has
 * departed; any room still in-house keeps the booking Checked-In. Derived
 * transitions also emit the booking activity entry and the housekeeping
 * side-effect that the booking-level path would have produced, so a booking
 * closed room-by-room behaves exactly like one closed from Booking Detail.
 */
export async function syncBookingStatusFromItems(bookingId: string): Promise<string | null> {
  if (fanOutDepth > 0) return null;
  const [{ data: booking }, { data: items }] = await Promise.all([
    supabase.from("bookings" as any).select("id, status").eq("id", bookingId).maybeSingle(),
    supabase.from("booking_items" as any).select("item_status").eq("booking_id", bookingId),
  ]);
  const current = String((booking as any)?.status ?? "");
  if (!current) return null;
  const next = deriveBookingStatusFromItems(((items ?? []) as any[]), current);
  if (!next || next === current) return null;
  const { error } = await supabase
    .from("bookings" as any)
    .update({ status: next } as any)
    .eq("id", bookingId);
  if (error) throw error;

  // Keep the booking activity feed truthful about room-driven transitions.
  try {
    const { logBookingActivity } = await import("@/lib/booking-activities-api");
    await logBookingActivity({
      booking_id: bookingId,
      action: next === "Checked-In" ? "check_in" : next === "Checked-Out" ? "check_out" : "reactivated",
      from_status: current,
      to_status: next,
      notes: "Derived from room-level status",
    } as any);
  } catch { /* non-blocking */ }

  // Housekeeping parity with the booking-level path. Both hooks are idempotent.
  try {
    const hk = await import("@/lib/hk-checkout-hook");
    if (next === "Checked-Out") await hk.onBookingCheckedOut(bookingId);
    else if (next === "Checked-In") await hk.onBookingCheckedIn(bookingId);
  } catch { /* non-blocking */ }

  return next;
}

/**
 * Fan a booking-level status change out to its room items.
 *
 * Root cause of the BJP Aditya (HEXB-310C65) case: booking-level Check-In /
 * Check-Out only wrote `bookings.status`, so every item stayed 'Confirmed'
 * forever. House View then had to guess whether a room had departed.
 *
 * Each room is now processed INDIVIDUALLY through the same shared per-room
 * engines that Room Management uses (`checkInBookingItem` /
 * `checkOutBookingItem`), so a booking-level action produces identical
 * per-room results: occupancy segments closed on the business date, per-room
 * housekeeping tasks, and a per-room activity timeline entry. When a room
 * cannot be processed operationally (no assigned room, or the shared engine
 * refuses), we fall back to stamping the status so booking and items never
 * drift apart.
 *
 * Financial validation is NOT re-run here — the entry point (Booking Detail,
 * Night Audit, override dialog) already decided the booking may depart.
 */
export async function fanOutBookingStatusToItems(bookingId: string, status: string) {
  const target = itemStatusForBookingStatus(status);
  if (!target) return;

  const { data: items, error } = await supabase
    .from("booking_items" as any)
    .select("id, item_status, assigned_room_id")
    .eq("booking_id", bookingId)
    .order("position", { ascending: true });
  if (error) throw error;

  const ops =
    target === "Checked-In" || target === "Checked-Out"
      ? await import("@/lib/booking-item-operations-api").catch(() => null)
      : null;

  const now = new Date().toISOString();
  fanOutDepth += 1;
  try {
    for (const it of ((items ?? []) as any[])) {
      const cur = String(it.item_status ?? "Confirmed");
      if (ITEM_IGNORED.has(cur) || cur === "Removed") continue;
      if (cur === target) continue;
      if (target === "Checked-In" && cur === "Checked-Out") continue; // already departed

      // Per-room operational path (preferred).
      if (ops && it.assigned_room_id) {
        try {
          if (target === "Checked-In") {
            await ops.checkInBookingItem(it.id);
            continue;
          }
          if (target === "Checked-Out") {
            await ops.checkOutBookingItem(it.id, { allowOverride: true });
            continue;
          }
        } catch {
          /* fall through to the status stamp below */
        }
      }

      // A room with no physical room assigned can never be operationally
      // in-house — leave it Confirmed rather than faking an occupancy.
      if (target === "Checked-In" && !it.assigned_room_id) continue;

      const patch: Record<string, any> = { item_status: target };
      if (target === "Checked-In") patch.checked_in_at = now;
      if (target === "Checked-Out") patch.checked_out_at = now;
      const { error: upErr } = await supabase
        .from("booking_items" as any)
        .update(patch as any)
        .eq("id", it.id);
      if (upErr) throw upErr;
    }
  } finally {
    fanOutDepth -= 1;
  }
}

