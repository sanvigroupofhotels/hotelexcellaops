/**
 * Shared Check-In flow controller.
 *
 * Single source of truth for the Check-In gate sequence used by every surface
 * that can check a guest in (Booking page, House View popup, Dashboard
 * Today's Arrivals, Night Audit / Reception Command Center).
 *
 * Gate order (mirrors the Booking page exactly):
 *   1. OTA phone gate — block if booking.lead_source is an OTA and there is
 *      no valid 10-digit guest mobile on file.
 *   2. Guest documents gate — open GuestDocumentsDialog (mode='checkin') if
 *      the booking has no guest documents on file.
 *   3. Room assignment gate — open RoomAssignmentDialog (mode='checkin-flow')
 *      if assignments < required.
 *   4. Commit — setBookingStatus(id, 'Checked-In') + log activity.
 *
 * Usage:
 *   const checkIn = useCheckInController({ onCheckedIn });
 *   <button onClick={() => checkIn.start(bookingId)}>Check-In</button>
 *   {checkIn.dialogs}
 */

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { getBooking, setBookingStatus } from "@/lib/bookings-api";
import { listBookingItems } from "@/lib/booking-items-api";
import {
  listAssignments,
  requiredRoomCount,
} from "@/lib/booking-room-assignments-api";
import { listGuestDocuments } from "@/lib/guest-documents-api";
import { logBookingActivity } from "@/lib/booking-activities-api";
import { logActivity } from "@/lib/activity-log";
import { RoomAssignmentDialog } from "@/components/room-assignment-dialog";
import { GuestDocumentsDialog } from "@/components/guest-documents-dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { FileWarning, ShieldAlert } from "lucide-react";

const OTA_SOURCES = [
  "Hotelzify",
  "FabHotels",
  "Booking.com",
  "Agoda",
  "MakeMyTrip",
  "Goibibo",
  "Expedia",
];

const FORCE_REASONS = [
  "Guest retrieving ID",
  "Corporate booking",
  "Returning guest",
  "Other",
];

type Step = "idle" | "phone" | "docs_choice" | "docs_upload" | "force_reason" | "rooms" | "committing";


export interface UseCheckInControllerOptions {
  /** Called after a successful commit, with the booking id. */
  onCheckedIn?: (bookingId: string) => void;
  /** Optional note appended to the activity log entry (e.g. "From Night Audit"). */
  note?: string | null;
}

export interface CheckInController {
  /** Begin the check-in gate sequence for this booking. */
  start: (bookingId: string) => void;
  /** Render exactly once near the root of the consuming component. */
  dialogs: React.ReactNode;
  /** True while a gate dialog is open or the commit is in flight. */
  isWorking: boolean;
}

export function useCheckInController(
  opts?: UseCheckInControllerOptions,
): CheckInController {
  const qc = useQueryClient();
  const [bookingId, setBookingId] = useState<string | null>(null);
  const [step, setStep] = useState<Step>("idle");
  const [phoneValue, setPhoneValue] = useState("");
  const [phoneSaving, setPhoneSaving] = useState(false);
  const [fromStatus, setFromStatus] = useState<string | null>(null);
  const [leadSource, setLeadSource] = useState<string | null>(null);

  const reset = () => {
    setBookingId(null);
    setStep("idle");
    setPhoneValue("");
    setPhoneSaving(false);
    setFromStatus(null);
    setLeadSource(null);
  };

  const commit = async (id: string, prevStatus: string | null) => {
    setStep("committing");
    try {
      const { transitionBookingStatus } = await import("@/lib/booking-status");
      await transitionBookingStatus({
        booking_id: id,
        kind: "check_in",
        page: "Check-In",
        source: "manual",
        metadata: opts?.note ? { note: opts.note } : null,
      });
      // Keep the legacy per-booking activity feed in sync.
      await logBookingActivity({
        booking_id: id,
        action: "check_in",
        from_status: prevStatus,
        to_status: "Checked-In",
        notes: opts?.note ?? null,
      });
      toast.success("Checked-In Successfully");
      qc.invalidateQueries({ queryKey: ["bookings"] });
      qc.invalidateQueries({ queryKey: ["booking", id] });
      qc.invalidateQueries({ queryKey: ["booking-room-assignments", id] });
      qc.invalidateQueries({ queryKey: ["booking-room-assignments-all"] });
      qc.invalidateQueries({ queryKey: ["booking-room-assignments-all-home"] });
      qc.invalidateQueries({ queryKey: ["night-audit-pending"] });
      opts?.onCheckedIn?.(id);
    } catch (e: any) {
      toast.error(e?.message ?? "Check-in failed");
    } finally {
      reset();
    }
  };

  /** Refetch state and advance to the next unmet gate (or commit). */
  const evaluate = async (id: string) => {
    try {
      const [b, items, docs, assignments] = await Promise.all([
        getBooking(id),
        listBookingItems(id),
        listGuestDocuments(id),
        listAssignments(id),
      ]);
      if (!b) throw new Error("Booking not found");

      setFromStatus(b.status ?? null);
      setLeadSource(b.lead_source ?? null);

      const isOTA = OTA_SOURCES.includes((b.lead_source ?? "").trim());
      const cleanPhone = (b.phone ?? "").replace(/[^\d+]/g, "");
      const hasValidPhone = /\d{10}/.test(cleanPhone);
      if (isOTA && !hasValidPhone) {
        setPhoneValue(cleanPhone);
        setStep("phone");
        return;
      }

      const hasDocs = (docs?.length ?? 0) > 0;
      const required = requiredRoomCount(items as any);
      const fullyAssigned = (assignments?.length ?? 0) >= required;

      if (!hasDocs) {
        setStep("docs");
        return;
      }
      if (!fullyAssigned) {
        setStep("rooms");
        return;
      }

      await commit(id, b.status ?? null);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not start Check-In");
      reset();
    }
  };

  const start = (id: string) => {
    setBookingId(id);
    setStep("committing"); // placeholder while fetching; prevents double-clicks
    void evaluate(id);
  };

  const reEvaluate = () => {
    if (!bookingId) return;
    void evaluate(bookingId);
  };

  const dialogs = (
    <>
      {bookingId && step === "rooms" && (
        <RoomAssignmentDialog
          bookingId={bookingId}
          open
          onClose={reset}
          mode="checkin-flow"
          onAllAssigned={reEvaluate}
        />
      )}

      {bookingId && step === "docs" && (
        <GuestDocumentsDialog
          bookingId={bookingId}
          open
          onClose={reset}
          mode="checkin"
          onComplete={reEvaluate}
        />
      )}

      {bookingId && step === "phone" && (
        <AlertDialog open onOpenChange={(o) => { if (!o) reset(); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Guest mobile required</AlertDialogTitle>
              <AlertDialogDescription>
                This booking arrived from{" "}
                <span className="font-medium text-foreground">
                  {leadSource ?? "an OTA"}
                </span>{" "}
                without a valid guest mobile. Please capture the guest's mobile
                number before check-in.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-2 py-2">
              <label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Guest Mobile
              </label>
              <input
                autoFocus
                type="tel"
                inputMode="tel"
                className="w-full bg-input/60 border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gold/40"
                value={phoneValue}
                onChange={(e) => setPhoneValue(e.target.value)}
                placeholder="+91 98765 43210"
              />
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={phoneSaving}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                disabled={phoneSaving}
                onClick={async (e) => {
                  e.preventDefault();
                  const cleaned = phoneValue.replace(/[^\d+]/g, "");
                  if (!/\d{10}/.test(cleaned)) {
                    toast.error("Enter a valid 10-digit mobile number");
                    return;
                  }
                  if (!bookingId) return;
                  setPhoneSaving(true);
                  try {
                    const { error } = await supabase
                      .from("bookings" as any)
                      .update({ phone: cleaned } as any)
                      .eq("id", bookingId);
                    if (error) throw error;
                    await qc.invalidateQueries({
                      queryKey: ["booking", bookingId],
                    });
                    toast.success("Mobile saved");
                    // Re-evaluate gates now that the phone is on file.
                    void evaluate(bookingId);
                  } catch (err: any) {
                    toast.error(err?.message ?? "Could not save mobile");
                  } finally {
                    setPhoneSaving(false);
                  }
                }}
              >
                {phoneSaving ? "Saving…" : "Save & Continue"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </>
  );

  // Suppress unused-var warning — fromStatus is captured into the closure
  // already; this read keeps the linter happy when we later expose state.
  void fromStatus;

  return { start, dialogs, isWorking: step !== "idle" };
}
