import { supabase } from "@/integrations/supabase/client";
import { removeAssignment } from "@/lib/booking-room-assignments-api";
import { getBusinessDate } from "@/lib/night-audit-api";

export type BookingItemStatus = "Confirmed" | "Checked-In" | "Checked-Out" | "Cancelled" | "No-Show";

export interface BookingItemActivityRow {
  id: string;
  item_id: string;
  booking_id: string;
  actor_id: string | null;
  actor_name: string | null;
  actor_role: string | null;
  action: string;
  field: string | null;
  old_value: string | null;
  new_value: string | null;
  summary: string | null;
  metadata: any;
  created_at: string;
}

async function getActor() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  return { id: user.id, name: user.email ?? null };
}

async function logItemActivity(input: {
  item_id: string;
  booking_id: string;
  action: string;
  field?: string | null;
  old_value?: string | null;
  new_value?: string | null;
  summary: string;
  metadata?: any;
}) {
  const actor = await getActor();
  await supabase.from("booking_item_activities" as any).insert({
    item_id: input.item_id,
    booking_id: input.booking_id,
    actor_id: actor.id,
    actor_name: actor.name,
    action: input.action,
    field: input.field ?? null,
    old_value: input.old_value ?? null,
    new_value: input.new_value ?? null,
    summary: input.summary,
    metadata: input.metadata ?? null,
  } as any);
}

async function getItem(itemId: string) {
  const { data, error } = await supabase
    .from("booking_items" as any)
    .select("id, booking_id, assigned_room_id, item_status")
    .eq("id", itemId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Room item not found");
  return data as any;
}

async function getAssignment(assignmentId: string) {
  const { data, error } = await supabase
    .from("booking_room_assignments" as any)
    .select("id, booking_id, room_id, item_id, start_date, end_date")
    .eq("id", assignmentId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Room assignment not found");
  return data as any;
}

async function closeAssignmentSegment(assignment: any, reason: string) {
  const businessDate = await getBusinessDate();
  const effectiveDate = businessDate > assignment.start_date ? businessDate : assignment.start_date;
  if (effectiveDate <= assignment.start_date) {
    const { error } = await supabase
      .from("booking_room_assignments" as any)
      .delete()
      .eq("id", assignment.id);
    if (error) throw error;
    return;
  }

  const { error } = await supabase
    .from("booking_room_assignments" as any)
    .update({ end_date: effectiveDate, ended_reason: reason } as any)
    .eq("id", assignment.id);
  if (error) throw error;
}

export async function checkInBookingItem(itemId: string) {
  const item = await getItem(itemId);
  if (!item.assigned_room_id) throw new Error("Assign a room before item check-in.");
  const previous = item.item_status ?? "Confirmed";
  const { error } = await supabase
    .from("booking_items" as any)
    .update({ item_status: "Checked-In", checked_in_at: new Date().toISOString() } as any)
    .eq("id", itemId);
  if (error) throw error;
  await logItemActivity({
    item_id: itemId,
    booking_id: item.booking_id,
    action: "item_check_in",
    field: "item_status",
    old_value: previous,
    new_value: "Checked-In",
    summary: "Room item checked in",
    metadata: { room_id: item.assigned_room_id },
  });
}

export async function checkOutBookingItem(itemId: string) {
  const item = await getItem(itemId);
  if (!item.assigned_room_id) throw new Error("No room assigned to check out.");
  const previous = item.item_status ?? "Confirmed";
  const businessDate = await getBusinessDate();
  const { data: activeAssignment, error: activeErr } = await supabase
    .from("booking_room_assignments" as any)
    .select("id, booking_id, room_id, item_id, start_date, end_date")
    .eq("item_id", itemId)
    .eq("room_id", item.assigned_room_id)
    .lte("start_date", businessDate)
    .gt("end_date", businessDate)
    .order("start_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (activeErr) throw activeErr;

  const { error } = await supabase
    .from("booking_items" as any)
    .update({ assigned_room_id: null, item_status: "Checked-Out", checked_out_at: new Date().toISOString() } as any)
    .eq("id", itemId);
  if (error) throw error;
  if (activeAssignment) await closeAssignmentSegment(activeAssignment, "item_check_out");
  try {
    const { onBookingItemCheckedOut } = await import("@/lib/hk-checkout-hook");
    await onBookingItemCheckedOut(item.booking_id, itemId, item.assigned_room_id);
  } catch {
    /* non-blocking housekeeping fanout */
  }
  await logItemActivity({
    item_id: itemId,
    booking_id: item.booking_id,
    action: "item_check_out",
    field: "item_status",
    old_value: previous,
    new_value: "Checked-Out",
    summary: "Room item checked out",
    metadata: { room_id: item.assigned_room_id },
  });
}

export async function removeRoomFromBookingItem(input: { itemId: string; assignmentId: string }) {
  const item = await getItem(input.itemId);
  const assignment = await getAssignment(input.assignmentId);
  const businessDate = await getBusinessDate();
  const started = assignment.start_date < businessDate || item.item_status === "Checked-In";
  if (started) {
    await closeAssignmentSegment(assignment, "room_removed");
    try {
      const { onBookingItemCheckedOut } = await import("@/lib/hk-checkout-hook");
      await onBookingItemCheckedOut(item.booking_id, input.itemId, assignment.room_id);
    } catch {
      /* non-blocking housekeeping fanout */
    }
  } else {
    await removeAssignment(item.booking_id, input.assignmentId);
  }
  const { error } = await supabase
    .from("booking_items" as any)
    .update({ assigned_room_id: null, item_status: "Confirmed", checked_in_at: null, checked_out_at: null } as any)
    .eq("id", input.itemId);
  if (error) throw error;
  await logItemActivity({
    item_id: input.itemId,
    booking_id: item.booking_id,
    action: "item_room_removed",
    field: "assigned_room_id",
    old_value: item.assigned_room_id ?? null,
    new_value: null,
    summary: "Room removed from item",
    metadata: { assignment_id: input.assignmentId },
  });
}

export async function listBookingItemActivities(bookingId: string) {
  const { data, error } = await supabase
    .from("booking_item_activities" as any)
    .select("*")
    .eq("booking_id", bookingId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as BookingItemActivityRow[];
}