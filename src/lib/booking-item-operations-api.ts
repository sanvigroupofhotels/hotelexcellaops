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

/**
 * Revert an item's Check-In. Inverse of `checkInBookingItem`:
 *   • status → Confirmed, `checked_in_at` cleared.
 *   • Existing room assignment segment is preserved (no historical rewrite).
 *   • Activity `item_check_in_reverted` logged.
 * Routed through the same shared orchestration layer so booking-level
 * "Revert All Check-Ins" simply iterates over items.
 */
export async function revertItemCheckIn(itemId: string) {
  const item = await getItem(itemId);
  const previous = item.item_status ?? "Confirmed";
  if (previous !== "Checked-In") throw new Error("Only Checked-In items can be reverted.");
  const { error } = await supabase
    .from("booking_items" as any)
    .update({ item_status: "Confirmed", checked_in_at: null } as any)
    .eq("id", itemId);
  if (error) throw error;
  await logItemActivity({
    item_id: itemId,
    booking_id: item.booking_id,
    action: "item_check_in_reverted",
    field: "item_status",
    old_value: previous,
    new_value: "Confirmed",
    summary: "Item check-in reverted",
    metadata: { room_id: item.assigned_room_id },
  });
}

/**
 * Revert an item's Check-Out. Inverse of `checkOutBookingItem`:
 *   • status → Checked-In, `checked_out_at` cleared.
 *   • Re-opens the most recent segment that was closed by item_check_out
 *     (or previously extends its end_date forward to the booking's check-out)
 *     when it is safe to do so (no overlap conflict).
 *   • Activity `item_check_out_reverted` logged.
 */
export async function revertItemCheckOut(itemId: string) {
  const { data: cur, error: readErr } = await supabase
    .from("booking_items" as any)
    .select("id, booking_id, item_status, assigned_room_id, check_out")
    .eq("id", itemId)
    .maybeSingle();
  if (readErr) throw readErr;
  if (!cur) throw new Error("Room item not found");
  const item = cur as any;
  if ((item.item_status ?? "") !== "Checked-Out")
    throw new Error("Only Checked-Out items can be reverted.");

  // Find the most recently-closed segment for this item to re-open.
  const { data: segs } = await supabase
    .from("booking_room_assignments" as any)
    .select("id, room_id, start_date, end_date, ended_reason")
    .eq("item_id", itemId)
    .order("end_date", { ascending: false })
    .limit(1);
  const seg = (segs ?? [])[0] as any | undefined;

  let restoredRoomId: string | null = null;
  if (seg && seg.ended_reason === "item_check_out") {
    // Extend segment back to the booking's original check_out (exclusive).
    const targetEnd = item.check_out as string;
    if (targetEnd > seg.end_date) {
      const { error: upErr } = await supabase
        .from("booking_room_assignments" as any)
        .update({ end_date: targetEnd, ended_reason: null } as any)
        .eq("id", seg.id);
      // Overlap-guarded by GiST exclusion; if it collides, leave segment closed.
      if (!upErr) restoredRoomId = seg.room_id;
    } else {
      restoredRoomId = seg.room_id;
    }
  }

  const { error } = await supabase
    .from("booking_items" as any)
    .update({
      item_status: "Checked-In",
      checked_out_at: null,
      assigned_room_id: restoredRoomId ?? item.assigned_room_id,
    } as any)
    .eq("id", itemId);
  if (error) throw error;

  await logItemActivity({
    item_id: itemId,
    booking_id: item.booking_id,
    action: "item_check_out_reverted",
    field: "item_status",
    old_value: "Checked-Out",
    new_value: "Checked-In",
    summary: restoredRoomId ? "Item check-out reverted (segment re-opened)" : "Item check-out reverted",
    metadata: { room_id: restoredRoomId },
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

/** Timeline scoped to a single operational room (Booking Item). */
export async function listItemActivities(itemId: string) {
  const { data, error } = await supabase
    .from("booking_item_activities" as any)
    .select("*")
    .eq("item_id", itemId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as BookingItemActivityRow[];
}

/**
 * Milestone 1 — update primary occupant on a Booking Item.
 * Reception frequently records the person actually staying in a room, which
 * may differ from the booking holder (corporate stays, group bookings).
 */
export async function updateBookingItemOccupant(input: {
  itemId: string;
  name: string | null;
  phone: string | null;
}) {
  const { data: current, error: readErr } = await supabase
    .from("booking_items" as any)
    .select("id, booking_id, primary_occupant_name, primary_phone")
    .eq("id", input.itemId)
    .maybeSingle();
  if (readErr) throw readErr;
  if (!current) throw new Error("Room item not found");
  const prev = current as any;

  const name = (input.name ?? "").trim() || null;
  const phone = (input.phone ?? "").trim() || null;
  if (prev.primary_occupant_name === name && prev.primary_phone === phone) return;

  const { error } = await supabase
    .from("booking_items" as any)
    .update({ primary_occupant_name: name, primary_phone: phone } as any)
    .eq("id", input.itemId);
  if (error) throw error;

  await logItemActivity({
    item_id: input.itemId,
    booking_id: prev.booking_id,
    action: "item_occupant_updated",
    field: "primary_occupant",
    old_value: `${prev.primary_occupant_name ?? ""} · ${prev.primary_phone ?? ""}`,
    new_value: `${name ?? ""} · ${phone ?? ""}`,
    summary: name ? `Occupant set to ${name}${phone ? ` (${phone})` : ""}` : "Occupant cleared",
  });
}

/**
 * Milestone 1 — update operational notes on a Booking Item.
 * Room-specific reception instructions (e.g. "no housekeeping before 11am").
 * Distinct from booking-level notes.
 */
export async function updateBookingItemOperationalNotes(input: {
  itemId: string;
  notes: string | null;
}) {
  const { data: current, error: readErr } = await supabase
    .from("booking_items" as any)
    .select("id, booking_id, operational_notes")
    .eq("id", input.itemId)
    .maybeSingle();
  if (readErr) throw readErr;
  if (!current) throw new Error("Room item not found");
  const prev = current as any;
  const next = (input.notes ?? "").trim() || null;
  if (prev.operational_notes === next) return;

  const { error } = await supabase
    .from("booking_items" as any)
    .update({ operational_notes: next } as any)
    .eq("id", input.itemId);
  if (error) throw error;

  await logItemActivity({
    item_id: input.itemId,
    booking_id: prev.booking_id,
    action: "item_notes_updated",
    field: "operational_notes",
    old_value: prev.operational_notes ?? null,
    new_value: next,
    summary: next ? "Operational notes updated" : "Operational notes cleared",
  });
}

/**
 * Move an operational room (Booking Item) to a different physical room.
 *
 * Milestone 0 canonical wrapper. Locates the item's currently active segment
 * and delegates to `splitAssignment` — the single server-side room-move path
 * backing every UI entry point (House View drag, Booking Detail Room
 * Management Grid, Room Assignment dialog).
 *
 * Behaviour guaranteed by the underlying `split_room_assignment` RPC:
 *   • Historical segments (start_date < business_date) are never modified.
 *   • Repeated occupancy (102 → 104 → 102) creates a fresh forward segment;
 *     the GiST exclusion constraint prevents genuine overlaps.
 *   • `booking_items.assigned_room_id` is re-pointed to the new room.
 *   • Per-item activity log written inside `splitAssignment`.
 *   • HK hooks fired for the vacated room.
 */
export async function moveBookingItemRoom(input: {
  itemId: string;
  newRoomId: string;
  effectiveDate?: string | null;
}) {
  const { splitAssignment } = await import("@/lib/booking-room-assignments-api");
  const item = await getItem(input.itemId);
  const businessDate = await getBusinessDate();

  // Locate the segment currently linked to this item on/after today. Prefer
  // the segment that covers the business date; fall back to the earliest
  // future segment; final fallback is any segment for this item.
  const { data: segments, error } = await supabase
    .from("booking_room_assignments" as any)
    .select("id,start_date,end_date,room_id")
    .eq("item_id", input.itemId)
    .order("start_date", { ascending: true });
  if (error) throw error;
  const list = (segments ?? []) as any[];
  if (list.length === 0) {
    throw new Error("This room has no active segment to move. Assign a room first.");
  }
  const active = list.find(
    (s) => s.start_date <= businessDate && s.end_date > businessDate,
  ) ?? list.find((s) => s.end_date > businessDate) ?? list[list.length - 1];

  if (active.room_id === input.newRoomId) {
    throw new Error("Guest is already in this room.");
  }

  await splitAssignment(item.booking_id, active.id, input.newRoomId, input.effectiveDate ?? null);
}
