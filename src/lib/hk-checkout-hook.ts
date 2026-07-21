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

    // UAT-047: pick only the FINAL segment(s) — historical rooms already
    // had their departure processed at the room-change split. `end_date` for
    // the last segment equals the booking's check_out.
    const { data: assigns } = await supabase.from("booking_room_assignments" as any)
      .select("room_id,start_date,end_date").eq("booking_id", bookingId);
    const rows = ((assigns ?? []) as any[]);
    const maxEnd = rows.reduce((m, r) => (String(r.end_date) > m ? String(r.end_date) : m), "");
    let roomIds = rows.filter((r) => String(r.end_date) === maxEnd).map((a) => a.room_id).filter(Boolean) as string[];
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

/**
 * Housekeeping — booking-extension side-effect hook.
 *
 * Called by `updateBookingStay()` immediately after a booking's check_out
 * date is moved further out while the guest is currently checked-in. For
 * every room assigned to the booking, ensure a `continue_service` task
 * exists for the CURRENT business date, unless the room has an exception
 * for today. Idempotent: safe to call for every extension (existing open
 * tasks for the same room/day are not duplicated).
 *
 * This closes the correctness gap where extensions performed via Edit
 * Booking, House View drag/drop, or the mobile Move dialog would leave
 * housekeeping without a service task until the next night audit ran.
 *
 * Non-blocking — failures are logged but never propagate back into the
 * stay-mutation flow.
 */
export async function onBookingExtended(bookingId: string): Promise<void> {
  try {
    const businessDate = await getBusinessDate();
    const correlation_id = newCorrelationId();

    // Only in-house stays qualify for continue-service. Pending / Confirmed
    // bookings whose dates were extended before check-in are handled by the
    // night audit generator when they eventually check in.
    const { data: b } = await supabase
      .from("bookings" as any)
      .select("status, check_out, room_id")
      .eq("id", bookingId)
      .maybeSingle();
    const status = (b as any)?.status;
    const checkOut = (b as any)?.check_out as string | undefined;
    if (status !== "Checked-In") return;
    if (!checkOut || checkOut <= businessDate) return; // stay must extend past today

    const { data: assigns } = await supabase.from("booking_room_assignments" as any)
      .select("room_id,start_date,end_date").eq("booking_id", bookingId).lte("start_date", businessDate).gte("end_date", businessDate);
    let roomIds = ((assigns ?? []) as any[]).map((a) => a.room_id).filter(Boolean) as string[];
    if (roomIds.length === 0 && (b as any)?.room_id) roomIds = [(b as any).room_id];
    if (roomIds.length === 0) return;

    // Skip rooms with an exception row for today.
    const { data: exceptions } = await supabase
      .from("housekeeping_room_exceptions" as any)
      .select("room_id")
      .eq("business_date", businessDate)
      .in("room_id", roomIds);
    const exceptionRooms = new Set<string>(((exceptions ?? []) as any[]).map((e) => e.room_id));

    let created = 0;
    for (const roomId of roomIds) {
      if (exceptionRooms.has(roomId)) continue;
      const task = await ensureContinueServiceTask({
        room_id: roomId,
        booking_id: bookingId,
        business_date: businessDate,
      });
      if (task) {
        // Only nudge status if the room is currently 'ready' — do not stomp
        // on rooms already in cleaning/servicing/dirty.
        const { data: r } = await supabase
          .from("rooms" as any).select("housekeeping_status").eq("id", roomId).maybeSingle();
        if ((r as any)?.housekeeping_status === "ready") {
          await setRoomHousekeepingStatus({
            roomId,
            next: "needs_service",
            reason: "Stay extended — service task ensured",
            correlationId: correlation_id,
            activityAction: "hk_service_task_generated" as any,
            metadata: { task_id: task.id, business_date: businessDate, booking_id: bookingId, trigger: "extension" },
          });
        }
        created += 1;
      }
    }

    if (created > 0) {
      void logActivity({
        page: "Housekeeping",
        action: "hk_extension_hook_ran" as any,
        entity_type: "booking",
        entity_id: bookingId,
        entity_reference: businessDate,
        summary: `Extension hook · ensured ${created} continue-service task(s)`,
        metadata: { businessDate, created, room_ids: roomIds },
        source: "manual",
        correlation_id,
      });
    }
  } catch (e: any) {
    void logActivity({
      page: "Housekeeping",
      action: "hk_extension_hook_failed" as any,
      entity_type: "booking",
      entity_id: bookingId,
      summary: `Housekeeping extension hook failed: ${e?.message ?? e}`,
      source: "manual",
    });
  }
}

/**
 * Housekeeping — checkout SHORTENED side-effect hook.
 *
 * Called by `updateBookingStay()` when a checked-in booking's check_out
 * date is pulled EARLIER. If the guest now checks out today (check_out
 * ≤ business_date), any open `continue_service` task on that room is
 * superseded — the operational workflow should transition to Checkout.
 * If the stay still extends past today, existing service tasks remain
 * untouched.
 *
 * Non-blocking. Idempotent.
 */
export async function onBookingCheckoutShortened(bookingId: string): Promise<void> {
  try {
    const businessDate = await getBusinessDate();
    const correlation_id = newCorrelationId();

    const { data: b } = await supabase
      .from("bookings" as any)
      .select("status, check_out, room_id")
      .eq("id", bookingId)
      .maybeSingle();
    const status = (b as any)?.status;
    const checkOut = (b as any)?.check_out as string | undefined;
    if (status !== "Checked-In") return;
    // Stay still extends past today — nothing to supersede.
    if (checkOut && checkOut > businessDate) return;

    const { data: assigns } = await supabase.from("booking_room_assignments" as any)
      .select("room_id,start_date,end_date").eq("booking_id", bookingId).lte("start_date", businessDate).gte("end_date", businessDate);
    let roomIds = ((assigns ?? []) as any[]).map((a) => a.room_id).filter(Boolean) as string[];
    if (roomIds.length === 0 && (b as any)?.room_id) roomIds = [(b as any).room_id];
    if (roomIds.length === 0) return;

    let superseded = 0;
    for (const roomId of roomIds) {
      const { data: updated } = await supabase.from("housekeeping_tasks" as any)
        .update({
          state: "skipped",
          skipped_reason: "superseded_by_checkout",
          finished_at: new Date().toISOString(),
        } as any)
        .eq("room_id", roomId)
        .eq("business_date", businessDate)
        .eq("type", "continue_service")
        .eq("state", "open")
        .select("id");
      superseded += ((updated ?? []) as any[]).length;
    }

    if (superseded > 0) {
      void logActivity({
        page: "Housekeeping",
        action: "hk_shortening_hook_ran" as any,
        entity_type: "booking",
        entity_id: bookingId,
        entity_reference: businessDate,
        summary: `Stay shortened · superseded ${superseded} service task(s)`,
        metadata: { businessDate, superseded, room_ids: roomIds },
        source: "manual",
        correlation_id,
      });
    }
  } catch (e: any) {
    void logActivity({
      page: "Housekeeping",
      action: "hk_shortening_hook_failed" as any,
      entity_type: "booking",
      entity_id: bookingId,
      summary: `Housekeeping shortening hook failed: ${e?.message ?? e}`,
      source: "manual",
    });
  }
}

/**
 * Housekeeping — check-in side-effect hook.
 *
 * Called by `setBookingStatus()` when a booking transitions to Checked-In.
 * Handles the operational reality where a room is re-occupied on the same
 * business date the previous guest checked out. Two cases:
 *
 *   • If the room already has a COMPLETED `checkout_clean` task for today,
 *     the room is clean and the new stay needs a `continue_service` task
 *     for tomorrow's expected turndown. We ensure that service task exists
 *     and log the transition. Room status is left in whatever state HK put
 *     it (ready/needs_service) — the completed checkout signals the room
 *     is available; the new service task represents the next work item.
 *
 *   • If a `checkout_clean` task is still OPEN, that means the previous
 *     guest hasn't been cleaned up yet — do nothing here. The existing
 *     checkout task remains authoritative until HK completes it.
 *
 * Multi-room bookings iterate every assignment. Idempotent, non-blocking.
 */
export async function onBookingCheckedIn(bookingId: string): Promise<void> {
  try {
    const businessDate = await getBusinessDate();
    const correlation_id = newCorrelationId();

    const { data: b } = await supabase
      .from("bookings" as any)
      .select("status, check_in, check_out, room_id")
      .eq("id", bookingId)
      .maybeSingle();
    if ((b as any)?.status !== "Checked-In") return;
    const checkOut = (b as any)?.check_out as string | undefined;
    // Only stays that extend past today need a service task.
    if (!checkOut || checkOut <= businessDate) return;

    const { data: assigns } = await supabase.from("booking_room_assignments" as any)
      .select("room_id,start_date,end_date").eq("booking_id", bookingId).lte("start_date", businessDate).gte("end_date", businessDate);
    let roomIds = ((assigns ?? []) as any[]).map((a) => a.room_id).filter(Boolean) as string[];
    if (roomIds.length === 0 && (b as any)?.room_id) roomIds = [(b as any).room_id];
    if (roomIds.length === 0) return;

    // Check for completed checkout_clean tasks today on any of these rooms.
    const { data: closed } = await supabase
      .from("housekeeping_tasks" as any)
      .select("room_id, type, state")
      .in("room_id", roomIds)
      .eq("business_date", businessDate)
      .eq("type", "checkout_clean")
      .eq("state", "done");
    const roomsWithCompletedCheckout = new Set<string>(
      ((closed ?? []) as any[]).map((r) => r.room_id),
    );

    // Skip rooms with an exception row for today.
    const { data: exceptions } = await supabase
      .from("housekeeping_room_exceptions" as any)
      .select("room_id")
      .eq("business_date", businessDate)
      .in("room_id", roomIds);
    const exceptionRooms = new Set<string>(((exceptions ?? []) as any[]).map((e) => e.room_id));

    let created = 0;
    for (const roomId of roomIds) {
      if (exceptionRooms.has(roomId)) continue;
      if (!roomsWithCompletedCheckout.has(roomId)) continue;
      const task = await ensureContinueServiceTask({
        room_id: roomId,
        booking_id: bookingId,
        business_date: businessDate,
      });
      if (task) created += 1;
    }

    if (created > 0) {
      void logActivity({
        page: "Housekeeping",
        action: "hk_checkin_hook_ran" as any,
        entity_type: "booking",
        entity_id: bookingId,
        entity_reference: businessDate,
        summary: `Re-occupied · ensured ${created} continue-service task(s)`,
        metadata: { businessDate, created, room_ids: roomIds },
        source: "manual",
        correlation_id,
      });
    }
  } catch (e: any) {
    void logActivity({
      page: "Housekeeping",
      action: "hk_checkin_hook_failed" as any,
      entity_type: "booking",
      entity_id: bookingId,
      summary: `Housekeeping check-in hook failed: ${e?.message ?? e}`,
      source: "manual",
    });
  }
}
