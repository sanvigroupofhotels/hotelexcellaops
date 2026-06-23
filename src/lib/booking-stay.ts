import { supabase } from "@/integrations/supabase/client";

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

export interface UpdateBookingStayInput {
  booking_id: string;
  /** Optional new check-in (YYYY-MM-DD) */
  new_check_in?: string;
  /** Optional new check-out (YYYY-MM-DD) */
  new_check_out?: string;
  /** Optional new room id */
  new_room_id?: string;
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
    .select("id, status, room_id, check_in, check_out, booking_reference")
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

  const newIn = input.new_check_in ?? oldIn;
  const newOut = input.new_check_out ?? oldOut;
  const newRoom = input.new_room_id ?? oldRoom;

  if (!newIn || !newOut) throw new Error("Missing check-in or check-out date.");
  if (!(newIn < newOut)) {
    throw new Error("Check-in date must be earlier than check-out date.");
  }

  const isCheckedIn = status === "Checked-In";

  if (isCheckedIn && newIn !== oldIn) {
    throw new Error("Check-in date cannot be changed after the guest has checked in.");
  }
  if (!isCheckedIn) {
    const today = todayKolkata();
    if (newIn < today) {
      throw new Error("Check-in date cannot be in the past.");
    }
  }

  // No-op short circuit
  const sameRoom = (newRoom ?? null) === (oldRoom ?? null);
  if (sameRoom && newIn === oldIn && newOut === oldOut) {
    return {
      booking_id,
      check_in: oldIn,
      check_out: oldOut,
      room_id: oldRoom,
      before: { check_in: oldIn, check_out: oldOut, room_id: oldRoom },
      after: { check_in: oldIn, check_out: oldOut, room_id: oldRoom },
    };
  }

  // Update the booking; DB triggers enforce conflict/block rules.
  const update: Record<string, any> = {};
  if (newIn !== oldIn) update.check_in = newIn;
  if (newOut !== oldOut) update.check_out = newOut;
  if (newRoom !== oldRoom) update.room_id = newRoom;

  try {
    const { error: bErr } = await supabase
      .from("bookings")
      .update(update as any)
      .eq("id", booking_id);
    if (bErr) throw bErr;

    // Move the corresponding assignment row when the room changed.
    if (!sameRoom && oldRoom && newRoom) {
      const { error: aErr } = await supabase
        .from("booking_room_assignments" as any)
        .update({ room_id: newRoom } as any)
        .eq("booking_id", booking_id)
        .eq("room_id", oldRoom);
      if (aErr) throw aErr;
    }
  } catch (e) {
    throw new Error(humanizeStayError(e));
  }

  const after = { check_in: newIn, check_out: newOut, room_id: newRoom ?? null };
  const before = { check_in: oldIn, check_out: oldOut, room_id: oldRoom };

  // Fire-and-forget activity log — never block the move on the log.
  try {
    await supabase.rpc("log_activity" as any, {
      p_page: "House View",
      p_action: "move_booking",
      p_entity_type: "booking",
      p_entity_id: booking_id,
      p_entity_reference: (current as any).booking_reference ?? null,
      p_summary: `Stay updated`,
      p_before: before as any,
      p_after: after as any,
      p_metadata: null,
    });
  } catch {
    /* swallow */
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
