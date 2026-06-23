/**
 * Single source of truth for booking STATUS transitions.
 *
 * Strictly separate from `updateBookingStay()` which handles ONLY room/date
 * mutations. This helper handles ONLY status transitions:
 *   - Reserved → Checked-In
 *   - Checked-In → Checked-Out
 *   - Cancellations / No-Show
 *   - Reverts (Checked-In→prior, Checked-Out→Checked-In)
 *
 * Status mutations never modify check_in / check_out / room_id.
 * Stay mutations never modify status.
 */

import { supabase } from "@/integrations/supabase/client";
import { setBookingStatus, getBooking } from "@/lib/bookings-api";
import type { BookingStatus } from "@/lib/mock-data";
import { logActivity, type ActivityAction, type ActivitySource } from "@/lib/activity-log";

export type TransitionKind =
  | "check_in"
  | "check_out"
  | "cancel"
  | "no_show"
  | "revert_check_in"
  | "revert_check_out";

const ACTION_FOR: Record<TransitionKind, ActivityAction> = {
  check_in: "guest_checked_in",
  check_out: "guest_checked_out",
  cancel: "booking_cancelled",
  no_show: "booking_no_show",
  revert_check_in: "guest_check_in_reverted",
  revert_check_out: "guest_check_out_reverted",
};

const TARGET_STATUS: Partial<Record<TransitionKind, BookingStatus>> = {
  check_in: "Checked-In" as BookingStatus,
  check_out: "Checked-Out" as BookingStatus,
  cancel: "Cancelled" as BookingStatus,
  no_show: "No-Show" as BookingStatus,
};

export interface TransitionInput {
  booking_id: string;
  kind: TransitionKind;
  /** Required for cancel / revert; recommended otherwise. */
  reason?: string | null;
  /** When reverting, the status to roll back to. */
  revert_to_status?: BookingStatus;
  source?: ActivitySource;
  page?: string;
  correlation_id?: string | null;
  metadata?: Record<string, any> | null;
}

export interface TransitionResult {
  booking_id: string;
  from_status: string | null;
  to_status: string;
}

export async function transitionBookingStatus(
  input: TransitionInput,
): Promise<TransitionResult> {
  const { booking_id, kind } = input;
  if (!booking_id) throw new Error("Missing booking id.");

  const current = await getBooking(booking_id);
  if (!current) throw new Error("Booking not found.");
  const from = (current.status as string | null) ?? null;

  let to: BookingStatus;
  if (kind === "revert_check_in") {
    to = (input.revert_to_status ?? "Confirmed") as BookingStatus;
  } else if (kind === "revert_check_out") {
    to = (input.revert_to_status ?? "Checked-In") as BookingStatus;
  } else {
    to = TARGET_STATUS[kind]!;
  }

  if (from === to) {
    return { booking_id, from_status: from, to_status: to };
  }

  await setBookingStatus(booking_id, to);

  await logActivity({
    page: input.page ?? "Bookings",
    action: ACTION_FOR[kind],
    entity_type: "booking",
    entity_id: booking_id,
    entity_reference: (current as any).booking_reference ?? null,
    summary: `${from ?? "—"} → ${to}${input.reason ? ` · ${input.reason}` : ""}`,
    before: { status: from },
    after: { status: to },
    metadata: input.metadata ?? (input.reason ? { reason: input.reason } : null),
    source: input.source ?? "manual",
    correlation_id: input.correlation_id ?? null,
  });

  // Touch updated_at for downstream listeners
  void supabase.from("bookings" as any).update({ updated_at: new Date().toISOString() } as any).eq("id", booking_id);

  return { booking_id, from_status: from, to_status: to };
}
