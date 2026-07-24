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
  listAssignments, addAssignment, removeAssignment, splitAssignment,
  requiredRoomCount, rebalanceBookingItemTypes, normalizeRoomType,
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
  /** Phase 2: assign/reassign a specific operational booking item. */
  targetItemId?: string | null;
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
  bookingId, open, onClose, mode, changingAssignmentId, onAllAssigned, targetItemId,
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
  const { data: businessDate } = useQuery({
    queryKey: ["business-date"],
    queryFn: async () => (await import("@/lib/night-audit-api")).getBusinessDate(),
    enabled: open,
    staleTime: 30_000,
  });

  const availabilityStart = useMemo(() => {
    const ci = booking?.check_in as string | undefined;
    if (!ci) return "";
    if (booking?.status === "Checked-In" && businessDate && businessDate > ci) return businessDate;
    return ci;
  }, [booking?.check_in, booking?.status, businessDate]);

  const { data: occupiedRoomIds = new Set<string>() } = useQuery({
    queryKey: ["rooms-occupied", availabilityStart, booking?.check_out, bookingId],
    queryFn: () => listOccupiedRoomIds(availabilityStart, booking!.check_out, bookingId),
    enabled: open && !!(availabilityStart && booking?.check_out),
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

  // Resolve any room_type label ("Oak Room", "oak", etc.) to the canonical
  // category string from the rooms table ("Oak"). Falls back to original.
  const canon = useMemo(() => {
    return (raw?: string | null) => {
      const n = normalizeRoomType(raw);
      if (!n) return "";
      const hit = categories.find((c) => normalizeRoomType(c) === n);
      return hit ?? (raw || "").trim();
    };
  }, [categories]);

  const required = requiredRoomCount(items as any);

  // requiredMix keyed by canonical category labels.
  const requiredMix = useMemo(() => {
    const out: Record<string, number> = {};
    for (const it of items as any[]) {
      const k = canon(it.room_type);
      if (!k) continue;
      out[k] = (out[k] ?? 0) + Math.max(1, Number(it.rooms ?? 1));
    }
    return out;
  }, [items, canon]);

  // Assigned-by-category, derived from current assignments + rooms.
  const assignedMix = useMemo(() => {
    const out: Record<string, number> = {};
    const co = booking?.check_out as string | undefined;
    for (const a of assignments) {
      if (availabilityStart && co && !(a.start_date < co && availabilityStart < a.end_date)) continue;
      const r = (rooms as any[]).find((x) => x.id === a.room_id);
      const t = canon(r?.room_type);
      if (!t) continue;
      out[t] = (out[t] ?? 0) + 1;
    }
    return out;
  }, [assignments, rooms, canon, booking?.check_out, availabilityStart]);

  // Next slot category (first category with a deficit).
  const nextSlotType: string | null = useMemo(() => {
    for (const [t, need] of Object.entries(requiredMix)) {
      const have = assignedMix[t] ?? 0;
      if (have < need) return t;
    }
    return null;
  }, [requiredMix, assignedMix]);

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
  const totalAssigned = useMemo(() => {
    const co = booking?.check_out as string | undefined;
    if (!availabilityStart || !co) return assignments.length;
    return assignments.filter((a) => a.start_date < co && availabilityStart < a.end_date).length;
  }, [assignments, booking?.check_out, availabilityStart]);
  const slotNumber = mode === "change"
    ? null
    : Math.min(required, totalAssigned + 1);

  // Filter rooms by selected category, exclude already-assigned/blocked/occupied/the-one-being-changed.
  const eligibleRooms = useMemo(() => {
    // UAT-047 final: only *currently-active* assignments (segments overlapping
    // the booking window) block re-selection. Historical segments closed by a
    // prior room-change are already released and must not gate future picks —
    // otherwise moving 105→201→105 hides 105 from the dropdown.
    const ci = availabilityStart || (booking?.check_in as string | undefined);
    const co = booking?.check_out as string | undefined;
    const activeSameBooking = new Set(
      assignments
        .filter((a) => a.id !== changingAssignment?.id)
        .filter((a) => !ci || !co || (a.start_date < co && ci < a.end_date))
        .map((a) => a.room_id),
    );
    return (rooms as any[]).filter((r) => {
      if (pickedCategory && r.room_type !== pickedCategory) return false;
      if (mode === "change" && changingAssignment && r.id === changingAssignment.room_id) return false;
      if (activeSameBooking.has(r.id)) return false;
      if (ci && co) {
        if (isRoomBlockedInRange(blocks as any, r.id, ci, co)) return false;
        if (occupiedRoomIds.has(r.id) && r.id !== changingAssignment?.room_id) return false;
      }
      return true;
    });
  }, [rooms, pickedCategory, assignments, booking, blocks, occupiedRoomIds, mode, changingAssignment, availabilityStart]);

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
        const newCat = canon(newRoom.room_type);
        const futureAssignedMix: Record<string, number> = { ...assignedMix };
        if (mode === "change" && changingRoom) {
          const oldCat = canon(changingRoom.room_type);
          futureAssignedMix[oldCat] = Math.max(0, (futureAssignedMix[oldCat] ?? 0) - 1);
          if (futureAssignedMix[oldCat] === 0) delete futureAssignedMix[oldCat];
        }
        futureAssignedMix[newCat] = (futureAssignedMix[newCat] ?? 0) + 1;

        // For not-yet-assigned slots, keep the original required types so totals add up.
        const desiredMix: Record<string, number> = {};
        for (const [t, n] of Object.entries(futureAssignedMix)) desiredMix[t] = n;
        const remainingAfter = Math.max(0, required - (totalAssigned + (mode === "change" ? 0 : 1)));
        if (remainingAfter > 0) {
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

      // Perform the assignment (and split the old one for change mode).
      if (mode === "change" && changingAssignment) {
        if (targetItemId && !changingAssignment.item_id) {
          await supabase
            .from("booking_room_assignments" as any)
            .update({ item_id: targetItemId } as any)
            .eq("id", changingAssignment.id);
        }
        // UAT-047: preserve history — split the segment on the business date
        // rather than delete + insert (which rewrote past occupancy).
        await splitAssignment(bookingId, changingAssignment.id, pickedRoomId, null);
        if (targetItemId) {
          await supabase
            .from("booking_items" as any)
            .update({ assigned_room_id: pickedRoomId } as any)
            .eq("id", targetItemId);
        }
        await logBookingActivity({
          booking_id: bookingId,
          action: "reactivated",
          from_status: booking?.status ?? null,
          to_status: booking?.status ?? null,
          notes: `Room Changed: ${changingRoom?.room_number ?? "?"} → ${newRoom?.room_number ?? "?"} (segment split)`,
        });
      } else {
        await addAssignment(bookingId, pickedRoomId, { item_id: targetItemId ?? null });
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
      const co = booking?.check_out as string | undefined;
      const latestCount = availabilityStart && co
        ? latest.filter((a) => a.start_date < co && availabilityStart < a.end_date).length
        : latest.length;
      if (latestCount >= required) {
        toast.success("All rooms assigned");
        onClose();
        onAllAssigned?.();
      } else {
        toast.success(`Room assigned (${latestCount} / ${required})`);
        // Dialog stays open; next slot type is recomputed by effect on assignments change.
      }
    },
    onError: (e: any) => {
      setConfirmCategoryChange(false);
      toast.error(e?.message ?? "Could not assign room");
    },
  });

  // Detect whether confirming would change categories.
  const wouldChangeCategories = useMemo(() => {
    if (!pickedRoomId) return false;
    const newRoom = (rooms as any[]).find((r) => r.id === pickedRoomId);
    if (!newRoom) return false;
    const newCat = canon(newRoom.room_type);
    if (mode === "change") {
      return !!changingRoom && newCat !== canon(changingRoom.room_type);
    }
    const have = assignedMix[newCat] ?? 0;
    const need = requiredMix[newCat] ?? 0;
    return have >= need;
  }, [pickedRoomId, rooms, mode, changingRoom, assignedMix, requiredMix, canon]);

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
    const newCat = canon(newRoom.room_type);
    const future: Record<string, number> = { ...assignedMix };
    if (mode === "change" && changingRoom) {
      const oldCat = canon(changingRoom.room_type);
      future[oldCat] = Math.max(0, (future[oldCat] ?? 0) - 1);
      if (future[oldCat] === 0) delete future[oldCat];
    }
    future[newCat] = (future[newCat] ?? 0) + 1;
    return Object.entries(future).map(([t, n]) => `${t} × ${n}`).join(", ");
  }, [pickedRoomId, rooms, assignedMix, mode, changingRoom, canon]);
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
                    {r.room_number}
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
