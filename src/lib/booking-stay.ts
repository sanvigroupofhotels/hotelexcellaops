import { supabase } from "@/integrations/supabase/client";
import { splitAssignment } from "@/lib/booking-room-assignments-api";

/**
 * Single source of truth for stay mutations (room change / date change).
 * Used by House View desktop DnD, mobile Move dialog, popup, Booking Details,
 * and Edit Booking. All call sites MUST go through this function.
 *
 * Business rules enforced (in order):
 *  1. Booking must be in a mutable status (rejects Checked-Out / Stay Completed /
 *     Cancelled / No-Show).
 *  2. If not yet Checked-In: new check_in >= today (Asia/Kolkata).
 *  3. If Checked-In: check_in is immutable.
 *  4. check_in < check_out.
 *  5. Room availability + blocks + occupancy overlap (enforced by DB triggers;
 *     this function translates trigger errors into business-friendly messages).
 */

export type StayMutationSource =
  | "manual"
  | "house_view"
  | "guest_portal"
  | "ota"
  | "night_audit"
  | "system"
  | "api";

export interface UpdateBookingStayInput {
  booking_id: string;
  /** Optional new check-in (YYYY-MM-DD) */
  new_check_in?: string;
  /** Optional new check-out (YYYY-MM-DD) */
  new_check_out?: string;
  /** Optional new room id */
  new_room_id?: string;
  /** Optional current room id for the specific House View chip/assignment being moved. */
  old_room_id?: string;
  /** Origin of this mutation. Defaults to 'manual'. Surfaces in activity_log.source. */
  source?: StayMutationSource;
  /** Optional page label for activity_log (defaults to a sensible value per source). */
  page?: string;
  /** Optional correlation id to group this event with sibling events in the same business transaction. */
  correlation_id?: string | null;
}

export interface UpdateBookingStayResult {
  booking_id: string;
  check_in: string;
  check_out: string;
  room_id: string | null;
  before: { check_in: string; check_out: string; room_id: string | null };
  after: { check_in: string; check_out: string; room_id: string | null };
}

const CLOSED = new Set(["Checked-Out", "Stay Completed", "Cancelled", "No-Show"]);

function todayKolkata(): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date()); // YYYY-MM-DD
}

function ymdAddDays(ymd: string, n: number): string {
  const d = new Date(ymd + "T00:00:00");
  d.setDate(d.getDate() + n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function ymdDiffDays(a: string, b: string): number {
  return Math.round((new Date(a + "T00:00:00").getTime() - new Date(b + "T00:00:00").getTime()) / 86400000);
}

/** Translate raw DB / trigger errors into friendly text. Never expose trigger names. */
export function humanizeStayError(raw: unknown): string {
  const msg = String((raw as any)?.message ?? raw ?? "").toLowerCase();
  if (!msg) return "Could not update the booking.";
  if (msg.includes("block") && msg.includes("maintenance")) {
    return "Cannot move booking. Destination room is blocked for maintenance.";
  }
  if (msg.includes("blocked")) {
    return "Cannot move booking. Destination room is blocked for maintenance.";
  }
  if (msg.includes("conflict") || msg.includes("overlap") || msg.includes("already booked") || msg.includes("already assigned")) {
    return "Cannot move booking. Destination room is already occupied for the selected dates.";
  }
  if (msg.includes("assign all rooms")) {
    return "Please assign all rooms before continuing.";
  }
  // Surface our own pre-flight errors as-is
  return String((raw as any)?.message ?? "Could not update the booking.");
}

export async function updateBookingStay(input: UpdateBookingStayInput): Promise<UpdateBookingStayResult> {
  const { booking_id } = input;
  if (!booking_id) throw new Error("Missing booking id.");

  // Load current booking
  const { data: current, error: loadErr } = await supabase
    .from("bookings")
    .select("id, status, room_id, check_in, check_out, booking_reference, total_override")
    .eq("id", booking_id)
    .maybeSingle();
  if (loadErr) throw loadErr;
  if (!current) throw new Error("Booking not found.");

  const status = String((current as any).status ?? "");
  if (CLOSED.has(status)) {
    throw new Error("This booking is closed and can no longer be modified.");
  }

  const oldRoom: string | null = (current as any).room_id ?? null;
  const oldIn: string = (current as any).check_in;
  const oldOut: string = (current as any).check_out;
  const oldOverride: number | null = (current as any).total_override == null ? null : Number((current as any).total_override);

  // Normalize incoming date strings to YYYY-MM-DD so a call site that hands
  // us an ISO timestamp or timezone-shifted string does not spuriously look
  // like a date change against the booking's stored date.
  const ymd = (s?: string | null) => (s ? String(s).slice(0, 10) : s);
  const oldInYmd = ymd(oldIn) as string;
  const oldOutYmd = ymd(oldOut) as string;
  const newIn = ymd(input.new_check_in) ?? oldInYmd;
  const newOut = ymd(input.new_check_out) ?? oldOutYmd;
  const moveFromRoom = input.old_room_id ?? oldRoom;
  const newRoom = input.new_room_id ?? moveFromRoom;

  if (!newIn || !newOut) throw new Error("Missing check-in or check-out date.");
  if (!(newIn < newOut)) {
    throw new Error("Check-in date must be earlier than check-out date.");
  }

  const isCheckedIn = status === "Checked-In";
  const sameRoom = (newRoom ?? null) === (moveFromRoom ?? null);
  const datesUnchanged = newIn === oldInYmd && newOut === oldOutYmd;

  // UAT-047 final: a room move must never be interpreted as a booking-date
  // modification. Only enforce check-in-date guards when the caller is
  // actually trying to change dates. Room-only moves (including moving a
  // Checked-In guest back to a previously-occupied room) skip these guards
  // entirely and flow through split_room_assignment below.
  if (!datesUnchanged) {
    if (isCheckedIn && newIn !== oldInYmd) {
      throw new Error("Check-in date cannot be changed after the guest has checked in.");
    }
    if (!isCheckedIn) {
      const today = todayKolkata();
      if (newIn < today) {
        throw new Error("Check-in date cannot be in the past.");
      }
    }
  }

  // No-op short circuit
  if (sameRoom && datesUnchanged) {
    return {
      booking_id,
      check_in: oldInYmd,
      check_out: oldOutYmd,
      room_id: moveFromRoom,
      before: { check_in: oldInYmd, check_out: oldOutYmd, room_id: moveFromRoom },
      after: { check_in: oldInYmd, check_out: oldOutYmd, room_id: moveFromRoom },
    };
  }

  // UAT-050: server-side room-type availability guard. When the stay window
  // changes, verify every room_type on this booking still fits inventory for
  // the new [newIn, newOut). Shared engine — same `getRoomTypeAvailability`
  // used by New Booking + capacity widgets — so there is exactly one source
  // of truth for "can this stay be accommodated?". Excluding this booking
  // folds its own current demand back into `available` so shortening or
  // shifting within already-owned inventory never trips the guard.
  if (newIn !== oldIn || newOut !== oldOut) {
    const { getRoomTypeAvailability } = await import("@/lib/room-inventory");
    const { data: bookingItems } = await supabase
      .from("booking_items" as any)
      .select("room_type, rooms")
      .eq("booking_id", booking_id);
    const demand: Record<string, number> = {};
    for (const it of (bookingItems ?? []) as any[]) {
      const key = String(it.room_type ?? "").trim();
      if (!key) continue;
      demand[key] = (demand[key] ?? 0) + Math.max(1, Number(it.rooms ?? 1) || 1);
    }
    if (Object.keys(demand).length > 0) {
      const avail = await getRoomTypeAvailability({
        check_in: newIn,
        check_out: newOut,
        exclude_booking_id: booking_id,
      });
      const norm = (s: string) => s.trim().replace(/\s+room$/i, "").toLowerCase();
      const shortages: string[] = [];
      for (const [label, need] of Object.entries(demand)) {
        const key = norm(label);
        const row = Object.values(avail.byType).find((r) => norm(r.room_type) === key);
        const availCount = row?.available ?? 0;
        if (availCount < need) {
          shortages.push(`${label}: need ${need}, ${availCount} available`);
        }
      }
      if (shortages.length > 0) {
        throw new Error(
          `Unable to update booking. Insufficient inventory for the requested dates — ${shortages.join("; ")}. Please shorten the stay, reduce rooms, or pick another room type.`,
        );
      }
    }
  }


  // Update the booking; DB triggers enforce conflict/block rules.
  const update: Record<string, any> = {};
  if (newIn !== oldIn) update.check_in = newIn;
  if (newOut !== oldOut) update.check_out = newOut;
    if (!sameRoom && (!moveFromRoom || moveFromRoom === oldRoom)) update.room_id = newRoom;

  // Pro-rata override extension: when reception extends/changes nights on a
  // booking that already has an overridden total, scale the override by the
  // ratio of new to old nights so the per-night agreed price is preserved.
  // Example: 2N override ₹4000 → extend to 3N → new override ₹6000.
  // Existing payments, discounts, and the pricing engine itself remain
  // untouched — only `total_override` is recomputed; downstream pricing
  // (subtotal, taxes, balance, portal, PDFs) recomputes from this single field.
  const oldNights = ymdDiffDays(oldOut, oldIn);
  const newNights = ymdDiffDays(newOut, newIn);
  if (oldOverride != null && oldNights > 0 && newNights > 0 && newNights !== oldNights) {
    update.total_override = Math.round((oldOverride / oldNights) * newNights);
  }


  try {
    const { error: bErr } = await supabase
      .from("bookings")
      .update(update as any)
      .eq("id", booking_id);
    if (bErr) throw bErr;

    // Room change → route through split_room_assignment RPC so history is
    // preserved (UAT-047). The RPC operates on the SPECIFIC segment matching
    // moveFromRoom only; sibling rooms on the same booking are untouched.
    // Pre-arrival segments (start_date >= business_date) are replaced in
    // place by the RPC, so this same path is safe for future bookings too.
    if (!sameRoom && moveFromRoom && newRoom) {
      const { data: segRow, error: segLookupErr } = await supabase
        .from("booking_room_assignments" as any)
        .select("id, start_date")
        .eq("booking_id", booking_id)
        .eq("room_id", moveFromRoom)
        .order("start_date", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (segLookupErr) throw segLookupErr;
      if ((segRow as any)?.id) {
        // Route through the shared helper so the HK "room moved" side-effect
        // (mark previous room dirty + ensure checkout task) fires once, for
        // every entry point (Booking Detail, House View drag/drop, mobile
        // Move dialog, Edit Booking, popup).
        await splitAssignment(booking_id, (segRow as any).id, newRoom, null);
      } else {
        // No segment for the from-room (edge case: legacy booking without
        // assignment rows). Fall back to updating bookings.room_id only —
        // no history to preserve.
      }
    }

    if (newIn !== oldIn || newOut !== oldOut) {
      // Anchor-based item resize: items that shared the booking's old start
      // adopt the new start; items that shared the booking's old end adopt
      // the new end. This correctly handles both whole-booking shifts and
      // pure extensions (where only check_out changes), so per-item night
      // counts stay aligned with the booking's true stay length.
      const { data: items, error: itemsErr } = await supabase
        .from("booking_items" as any)
        .select("id, check_in, check_out")
        .eq("booking_id", booking_id);
      if (itemsErr) throw itemsErr;
      for (const item of (items ?? []) as any[]) {
        const itemIn = item.check_in || oldIn;
        const itemOut = item.check_out || oldOut;
        const patch = {
          check_in: itemIn === oldIn ? newIn : itemIn,
          check_out: itemOut === oldOut ? newOut : itemOut,
        };
        if (patch.check_in === itemIn && patch.check_out === itemOut) continue;
        const { error: itemErr } = await supabase
          .from("booking_items" as any)
          .update(patch)
          .eq("id", item.id);
        if (itemErr) throw itemErr;
      }

      // Anchor-based assignment segment resize. `booking_room_assignments`
      // rows carry their own [start_date, end_date) window (UAT-047). When
      // the booking's stay window shifts or extends, segments anchored to
      // the old start/end must follow — otherwise an extension leaves the
      // trailing days with no assignment coverage, so House View chips
      // render truncated and visually collide with the next-day booking
      // in the same room. Also keeps the popup's check-out in sync since
      // the paired slot's check_out is min(item, segment).
      const { data: segs, error: segsErr } = await supabase
        .from("booking_room_assignments" as any)
        .select("id, start_date, end_date")
        .eq("booking_id", booking_id);
      if (segsErr) throw segsErr;
      for (const seg of (segs ?? []) as any[]) {
        const segIn = seg.start_date || oldIn;
        const segOut = seg.end_date || oldOut;
        const patch = {
          start_date: segIn === oldIn ? newIn : segIn,
          end_date: segOut === oldOut ? newOut : segOut,
        };
        if (patch.start_date === segIn && patch.end_date === segOut) continue;
        const { error: segErr } = await supabase
          .from("booking_room_assignments" as any)
          .update(patch)
          .eq("id", seg.id);
        if (segErr) throw segErr;
      }
    }
  } catch (e) {
    throw new Error(humanizeStayError(e));
  }

  const after = { check_in: newIn, check_out: newOut, room_id: newRoom ?? null };
  const before = { check_in: oldIn, check_out: oldOut, room_id: moveFromRoom ?? null };

  // Fire-and-forget activity log — never block the move on the log.
  try {
    const source = input.source ?? "manual";
    const defaultPage =
      source === "house_view" ? "House View"
      : source === "ota" ? "OTA Sync"
      : source === "guest_portal" ? "Guest Portal"
      : "Booking";
    const roomChanged = (newRoom ?? null) !== (oldRoom ?? null);
    const datesChanged = newIn !== oldIn || newOut !== oldOut;
    const action = roomChanged && !datesChanged
      ? "booking_moved"
      : (datesChanged && !roomChanged ? "booking_updated" : "booking_moved");
    await supabase.rpc("log_activity" as any, {
      p_page: input.page ?? defaultPage,
      p_action: action,
      p_entity_type: "booking",
      p_entity_id: booking_id,
      p_entity_reference: (current as any).booking_reference ?? null,
      p_summary: `Stay updated`,
      p_before: before as any,
      p_after: after as any,
      p_metadata: null,
      p_source: source,
      p_property_id: null,
      p_correlation_id: input.correlation_id ?? null,
    } as any);
  } catch {
    /* swallow */
  }

  // Housekeeping extension / shortening side-effect. Fires whenever the
  // checkout date moves in either direction. `onBookingExtended` ensures a
  // continue-service task exists for today; `onBookingCheckoutShortened`
  // supersedes any now-obsolete service task if the guest no longer stays
  // past today. Covers every entry point: Edit Booking, House View
  // drag/drop, mobile Move dialog, Booking Detail popup, guest portal.
  // Non-blocking — the hooks own their own error logging.
  if (newOut > oldOut) {
    try {
      const { onBookingExtended } = await import("@/lib/hk-checkout-hook");
      await onBookingExtended(booking_id);
    } catch { /* non-blocking */ }
  } else if (newOut < oldOut) {
    try {
      const { onBookingCheckoutShortened } = await import("@/lib/hk-checkout-hook");
      await onBookingCheckoutShortened(booking_id);
    } catch { /* non-blocking */ }
  }

  // Pricing sync — recompute stored amount/subtotal/taxes from the freshly
  // resized booking_items. Keeps House View / Move Dialog / Popup / Edit
  // Booking in perfect agreement without any parallel pricing logic.
  if (newIn !== oldIn || newOut !== oldOut) {
    try {
      const { recomputeBookingAmount } = await import("@/lib/booking-pricing-sync");
      await recomputeBookingAmount(booking_id);
    } catch { /* non-blocking */ }
  }

  return {
    booking_id,
    check_in: newIn,
    check_out: newOut,
    room_id: newRoom ?? null,
    before,
    after,
  };
}
