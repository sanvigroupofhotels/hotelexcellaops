import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Loader2, DoorOpen, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

import { listRooms, listOccupiedRoomIds } from "@/lib/rooms-api";
import { listActiveBlocks, isRoomBlockedInRange } from "@/lib/blocks-api";
import { listBookingItems } from "@/lib/booking-items-api";
import {
  listAssignments, addAssignment, removeAssignment,
  requiredRoomCount, requiredByType, rebalanceBookingItemTypes, normalizeRoomType,
} from "@/lib/booking-room-assignments-api";
import { logBookingActivity } from "@/lib/booking-activities-api";

type Mode = "assign-one" | "change" | "checkin-flow";

interface Props {
  bookingId: string;
  open: boolean;
  onClose: () => void;
  mode: Mode;
  /** For "change" mode: id of the assignment row being swapped. */
  changingAssignmentId?: string | null;
  /** Called when in checkin-flow and all required rooms have been assigned. */
  onAllAssigned?: () => void;
}

/**
 * Shared Room Assignment dialog.
 *
 * Behaviours:
 *   - "assign-one": one assignment, close on save.
 *   - "change":     swap an existing assignment (defaults Category to existing room's type).
 *   - "checkin-flow": loop — after each save, if assignments < required keep dialog
 *                     open with next slot pre-selected; once complete fire onAllAssigned.
 *
 * Two dropdowns: Room Category, then Room (only available rooms of that category).
 * If selected category differs from the booking's current type mix, a Category-Change
 * confirmation appears. On Proceed → booking_items room_type labels are re-balanced
 * (pricing preserved), then the room is assigned.
 */
export function RoomAssignmentDialog({
  bookingId, open, onClose, mode, changingAssignmentId, onAllAssigned,
}: Props) {
  const qc = useQueryClient();

  const { data: booking } = useQuery({
    queryKey: ["booking", bookingId],
    queryFn: async () => {
      const { data } = await supabase.from("bookings" as any).select("*").eq("id", bookingId).maybeSingle();
      return data as any;
    },
    enabled: open,
  });
  const { data: items = [] } = useQuery({
    queryKey: ["booking-items", bookingId],
    queryFn: () => listBookingItems(bookingId),
    enabled: open,
  });
  const { data: assignments = [] } = useQuery({
    queryKey: ["booking-room-assignments", bookingId],
    queryFn: () => listAssignments(bookingId),
    enabled: open,
  });
  const { data: rooms = [] } = useQuery({
    queryKey: ["rooms", "active"], queryFn: () => listRooms(true), enabled: open,
  });
  const { data: blocks = [] } = useQuery({
    queryKey: ["blocks", "active"], queryFn: listActiveBlocks, enabled: open,
  });
  const { data: occupiedRoomIds = new Set<string>() } = useQuery({
    queryKey: ["rooms-occupied", booking?.check_in, booking?.check_out, bookingId],
    queryFn: () => listOccupiedRoomIds(booking!.check_in, booking!.check_out, bookingId),
    enabled: open && !!(booking?.check_in && booking?.check_out),
  });

  // Distinct categories — group rooms by their base label (first word of room_type).
  const categories = useMemo(() => {
    const set = new Map<string, string>();
    for (const r of rooms as any[]) {
      const t = (r.room_type || "").trim();
      if (t) set.set(t, t);
    }
    return Array.from(set.keys()).sort();
  }, [rooms]);

  const required = requiredRoomCount(items as any);
  const requiredMix = useMemo(() => requiredByType(items as any), [items]);

  // Assigned-by-type (normalized), derived from current assignments + rooms.
  const assignedMix = useMemo(() => {
    const out: Record<string, number> = {};
    for (const a of assignments) {
      const r = (rooms as any[]).find((x) => x.id === a.room_id);
      const t = normalizeRoomType(r?.room_type);
      if (!t) continue;
      out[t] = (out[t] ?? 0) + 1;
    }
    return out;
  }, [assignments, rooms]);

  // Next slot category (first type with a deficit). Returns the *display* label
  // by finding the matching rooms category that normalizes to this key.
  const nextSlotType: string | null = useMemo(() => {
    for (const [normT, need] of Object.entries(requiredMix)) {
      const have = assignedMix[normT] ?? 0;
      if (have < need) {
        // Map back to a display category from rooms
        const match = categories.find((c) => normalizeRoomType(c) === normT);
        return match ?? null;
      }
    }
    return null;
  }, [requiredMix, assignedMix, categories]);

  // The assignment being changed (change mode only).
  const changingAssignment = changingAssignmentId
    ? assignments.find((a) => a.id === changingAssignmentId)
    : null;
  const changingRoom = changingAssignment
    ? (rooms as any[]).find((r) => r.id === changingAssignment.room_id)
    : null;

  const [pickedCategory, setPickedCategory] = useState<string>("");
  const [pickedRoomId, setPickedRoomId] = useState<string>("");
  const [confirmCategoryChange, setConfirmCategoryChange] = useState(false);

  // Default category whenever dialog opens, items load, or current slot advances.
  useEffect(() => {
    if (!open) return;
    if (mode === "change") {
      setPickedCategory(changingRoom?.room_type ?? "");
    } else {
      setPickedCategory(nextSlotType ?? categories[0] ?? "");
    }
    setPickedRoomId("");
  }, [open, mode, changingRoom?.room_type, nextSlotType, categories.join("|")]);

  // Room counter (current / required) for header.
  const totalAssigned = assignments.length;
  const slotNumber = mode === "change"
    ? null
    : Math.min(required, totalAssigned + 1);

  // Filter rooms by selected category, exclude already-assigned/blocked/occupied/the-one-being-changed.
  const eligibleRooms = useMemo(() => {
    return (rooms as any[]).filter((r) => {
      if (pickedCategory && r.room_type !== pickedCategory) return false;
      if (mode === "change" && changingAssignment && r.id === changingAssignment.room_id) return false;
      if (assignments.some((a) => a.room_id === r.id && a.id !== changingAssignment?.id)) return false;
      if (booking?.check_in && booking?.check_out) {
        if (isRoomBlockedInRange(blocks as any, r.id, booking.check_in, booking.check_out)) return false;
        if (occupiedRoomIds.has(r.id) && r.id !== changingAssignment?.room_id) return false;
      }
      return true;
    });
  }, [rooms, pickedCategory, assignments, booking, blocks, occupiedRoomIds, mode, changingAssignment]);

  // ---------- Mutations ----------
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["booking", bookingId] });
    qc.invalidateQueries({ queryKey: ["booking-items", bookingId] });
    qc.invalidateQueries({ queryKey: ["booking-items-all"] });
    qc.invalidateQueries({ queryKey: ["booking-room-assignments", bookingId] });
    qc.invalidateQueries({ queryKey: ["booking-room-assignments-all"] });
    qc.invalidateQueries({ queryKey: ["bookings"] });
    qc.invalidateQueries({ queryKey: ["booking-activities", bookingId] });
  };

  const doAssign = useMutation({
    mutationFn: async (rebalance: boolean) => {
      if (!pickedRoomId) throw new Error("Pick a room");
      const newRoom = (rooms as any[]).find((r) => r.id === pickedRoomId);

      // Build the post-change mix (what booking_items should look like) if rebalancing.
      if (rebalance) {
        const futureAssignedMix: Record<string, number> = { ...assignedMix };
        if (mode === "change" && changingRoom) {
          futureAssignedMix[changingRoom.room_type] = Math.max(0, (futureAssignedMix[changingRoom.room_type] ?? 0) - 1);
          if (futureAssignedMix[changingRoom.room_type] === 0) delete futureAssignedMix[changingRoom.room_type];
        }
        futureAssignedMix[newRoom.room_type] = (futureAssignedMix[newRoom.room_type] ?? 0) + 1;

        // For not-yet-assigned slots, keep the original required types so totals add up.
        const desiredMix: Record<string, number> = {};
        for (const [t, n] of Object.entries(futureAssignedMix)) desiredMix[t] = n;
        const remainingAfter = Math.max(0, required - (totalAssigned + (mode === "change" ? 0 : 1)));
        if (remainingAfter > 0) {
          // Carry leftover required slots from the *original* mix that aren't yet filled
          const leftoverRequired: Record<string, number> = { ...requiredMix };
          for (const [t, n] of Object.entries(desiredMix)) {
            leftoverRequired[t] = Math.max(0, (leftoverRequired[t] ?? 0) - n);
          }
          for (const [t, n] of Object.entries(leftoverRequired)) {
            if (n > 0) desiredMix[t] = (desiredMix[t] ?? 0) + n;
          }
        }
        await rebalanceBookingItemTypes(bookingId, desiredMix, items as any);
        const oldStr = Object.entries(requiredMix).map(([t, n]) => `${t} × ${n}`).join(", ");
        const newStr = Object.entries(desiredMix).map(([t, n]) => `${t} × ${n}`).join(", ");
        await logBookingActivity({
          booking_id: bookingId,
          action: "reactivated",
          from_status: booking?.status ?? null,
          to_status: booking?.status ?? null,
          notes: `Room Category Changed · ${oldStr} → ${newStr}`,
        });
      }

      // Perform the assignment (and remove the old one for change mode).
      if (mode === "change" && changingAssignment) {
        await addAssignment(bookingId, pickedRoomId);
        await removeAssignment(bookingId, changingAssignment.id);
        await logBookingActivity({
          booking_id: bookingId,
          action: "reactivated",
          from_status: booking?.status ?? null,
          to_status: booking?.status ?? null,
          notes: `Room Changed: ${changingRoom?.room_number ?? "?"} → ${newRoom?.room_number ?? "?"}`,
        });
      } else {
        await addAssignment(bookingId, pickedRoomId);
        await logBookingActivity({
          booking_id: bookingId,
          action: "reactivated",
          from_status: booking?.status ?? null,
          to_status: booking?.status ?? null,
          notes: `Room Assigned: ${newRoom?.room_number ?? "?"}`,
        });
      }
    },
    onSuccess: async () => {
      invalidate();
      setConfirmCategoryChange(false);
      setPickedRoomId("");

      if (mode === "change") {
        toast.success("Room changed");
        onClose();
        return;
      }
      if (mode === "assign-one") {
        toast.success("Room assigned");
        onClose();
        return;
      }
      // checkin-flow: refetch latest assignments, then decide.
      const latest = await listAssignments(bookingId);
      if (latest.length >= required) {
        toast.success("All rooms assigned");
        onClose();
        onAllAssigned?.();
      } else {
        toast.success(`Room assigned (${latest.length} / ${required})`);
        // Dialog stays open; next slot type is recomputed by effect on assignments change.
      }
    },
    onError: (e: any) => {
      setConfirmCategoryChange(false);
      toast.error(e?.message ?? "Could not assign room");
    },
  });

  // Detect whether confirming would change categories (normalized comparison).
  const wouldChangeCategories = useMemo(() => {
    if (!pickedRoomId) return false;
    const newRoom = (rooms as any[]).find((r) => r.id === pickedRoomId);
    if (!newRoom) return false;
    const newNorm = normalizeRoomType(newRoom.room_type);
    if (mode === "change") {
      return !!changingRoom && newNorm !== normalizeRoomType(changingRoom.room_type);
    }
    // assign-one / checkin-flow: not a change if this category still has a deficit
    const have = assignedMix[newNorm] ?? 0;
    const need = requiredMix[newNorm] ?? 0;
    return have >= need; // no slot of this type left → this would change the mix
  }, [pickedRoomId, rooms, mode, changingRoom, assignedMix, requiredMix]);

  const handleConfirm = () => {
    if (!pickedRoomId) return;
    if (wouldChangeCategories) {
      setConfirmCategoryChange(true);
      return;
    }
    doAssign.mutate(false);
  };

  // Computed strings for the category-change confirm dialog.
  const proposedMixStr = useMemo(() => {
    if (!pickedRoomId) return "";
    const newRoom = (rooms as any[]).find((r) => r.id === pickedRoomId);
    if (!newRoom) return "";
    const future: Record<string, number> = { ...assignedMix };
    if (mode === "change" && changingRoom) {
      future[changingRoom.room_type] = Math.max(0, (future[changingRoom.room_type] ?? 0) - 1);
      if (future[changingRoom.room_type] === 0) delete future[changingRoom.room_type];
    }
    future[newRoom.room_type] = (future[newRoom.room_type] ?? 0) + 1;
    return Object.entries(future).map(([t, n]) => `${t} × ${n}`).join(", ");
  }, [pickedRoomId, rooms, assignedMix, mode, changingRoom]);
  const originalMixStr = Object.entries(requiredMix).map(([t, n]) => `${t} × ${n}`).join(", ");

  // Title
  const title = mode === "change"
    ? "Change Room"
    : mode === "assign-one"
      ? "Assign Room"
      : `Assign Room ${slotNumber} of ${required}`;

  return (
    <>
      <AlertDialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <DoorOpen className="h-4 w-4 text-gold" /> {title}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {mode === "change" && changingRoom ? (
                <>Swap Room <span className="font-medium">{changingRoom.room_number}</span> ({changingRoom.room_type}) for another room.</>
              ) : mode === "checkin-flow" ? (
                <>Pick a Room Category and a specific Room. Once all {required} rooms are assigned, Check-In will proceed automatically.</>
              ) : (
                <>Pick a Room Category and a specific Room.</>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="px-1 space-y-3">
            {/* Room Category dropdown */}
            <div>
              <label className="block text-[11px] uppercase tracking-wider text-muted-foreground mb-1">Room Category</label>
              <select
                value={pickedCategory}
                onChange={(e) => { setPickedCategory(e.target.value); setPickedRoomId(""); }}
                className="w-full bg-input/60 border border-border rounded-md px-3 py-2 text-sm"
              >
                <option value="">Select category…</option>
                {categories.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>

            {/* Room dropdown */}
            <div>
              <label className="block text-[11px] uppercase tracking-wider text-muted-foreground mb-1">Room</label>
              <select
                value={pickedRoomId}
                onChange={(e) => setPickedRoomId(e.target.value)}
                disabled={!pickedCategory}
                className="w-full bg-input/60 border border-border rounded-md px-3 py-2 text-sm disabled:opacity-50"
              >
                <option value="">{pickedCategory ? "Select a room…" : "Pick a category first"}</option>
                {eligibleRooms.map((r: any) => (
                  <option key={r.id} value={r.id}>
                    Room {r.room_number} · Floor {r.floor}
                  </option>
                ))}
              </select>
              {pickedCategory && eligibleRooms.length === 0 && (
                <p className="text-[10px] text-warning mt-1">
                  No available {pickedCategory} rooms for these dates. Try another category.
                </p>
              )}
              <p className="text-[10px] text-muted-foreground mt-1">
                Showing only available {pickedCategory || "category"} rooms — occupied, blocked and already-assigned rooms are hidden.
              </p>
            </div>

            {mode === "checkin-flow" && (
              <div className="rounded-md bg-secondary/40 border border-border px-3 py-2 text-[11px] text-muted-foreground">
                Progress: {totalAssigned} / {required} assigned. Required mix: {originalMixStr || "—"}
              </div>
            )}
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={!pickedRoomId || doAssign.isPending}
              onClick={(e) => { e.preventDefault(); handleConfirm(); }}
            >
              {doAssign.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}
              {mode === "change" ? "Change" : "Save"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Category change confirmation */}
      <AlertDialog open={confirmCategoryChange} onOpenChange={(o) => { if (!o && !doAssign.isPending) setConfirmCategoryChange(false); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-warning" /> Room Category Change
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <div>
                Booking currently has: <span className="font-medium text-foreground">{originalMixStr || "—"}</span>
              </div>
              <div>
                You are assigning to: <span className="font-medium text-foreground">{proposedMixStr || "—"}</span>
              </div>
              <div className="pt-1">Do you want to update the booking room categories? Pricing, rates, taxes and existing charges will NOT be changed.</div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={doAssign.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={doAssign.isPending}
              onClick={(e) => { e.preventDefault(); doAssign.mutate(true); }}
            >
              {doAssign.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}
              Proceed
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
