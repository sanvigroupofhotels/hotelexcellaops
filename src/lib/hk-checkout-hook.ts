/**
 * Housekeeping — checkout side-effect hook.
 *
 * Called by the booking check-out mutation immediately after status flips to
 * Checked-Out. Responsibilities:
 *   1. For every room assigned to the booking, flip housekeeping_status → dirty.
 *   2. Create a `checkout_clean` task per room (idempotent).
 *   3. Any open `continue_service` task on that room for today is set
 *      `skipped='superseded_by_checkout'` (design §7 edge #1).
 *
 * Non-blocking: failures are logged but never propagate back into the
 * checkout flow, so a housekeeping outage never blocks reception.
 */
import { supabase } from "@/integrations/supabase/client";
import { setRoomHousekeepingStatus } from "@/lib/hk-status";
import { ensureCheckoutTask, ensureContinueServiceTask } from "@/lib/hk-tasks";
import { logActivity, newCorrelationId } from "@/lib/activity-log";
import { getBusinessDate } from "@/lib/night-audit-api";

export async function onBookingCheckedOut(bookingId: string): Promise<void> {
  try {
    const businessDate = await getBusinessDate();
    const correlation_id = newCorrelationId();

    // Room IDs come from booking_room_assignments; fall back to bookings.room_id
    // for legacy single-room stays.
    const { data: assigns } = await supabase.from("booking_room_assignments" as any)
      .select("room_id").eq("booking_id", bookingId);
    let roomIds = ((assigns ?? []) as any[]).map((a) => a.room_id).filter(Boolean) as string[];
    if (roomIds.length === 0) {
      const { data: b } = await supabase.from("bookings" as any)
        .select("room_id").eq("id", bookingId).maybeSingle();
      if ((b as any)?.room_id) roomIds = [(b as any).room_id];
    }
    if (roomIds.length === 0) return;

    for (const roomId of roomIds) {
      // Any OPEN service task for this room + day is superseded. `in_progress`
      // tasks are left alone so a housekeeper mid-way through service does not
      // silently lose their entries — they finish normally, then the checkout
      // task takes over.
      await supabase.from("housekeeping_tasks" as any)
        .update({
          state: "skipped",
          skipped_reason: "superseded_by_checkout",
          finished_at: new Date().toISOString(),
        } as any)
        .eq("room_id", roomId)
        .eq("business_date", businessDate)
        .eq("type", "continue_service")
        .eq("state", "open");

      // Flip housekeeping → dirty.
      await setRoomHousekeepingStatus({
        roomId,
        next: "dirty",
        reason: "Guest checked out",
        correlationId: correlation_id,
        activityAction: "hk_checkout_marked_dirty" as any,
        metadata: { booking_id: bookingId, business_date: businessDate },
      });

      // Create the checkout clean task.
      await ensureCheckoutTask({
        room_id: roomId,
        booking_id: bookingId,
        business_date: businessDate,
        correlation_id,
      });
    }
  } catch (e: any) {
    void logActivity({
      page: "Housekeeping",
      action: "hk_checkout_hook_failed" as any,
      entity_type: "booking",
      entity_id: bookingId,
      summary: `Housekeeping checkout hook failed: ${e?.message ?? e}`,
      source: "manual",
    });
  }
}
