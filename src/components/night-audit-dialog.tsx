import { useState, type ReactNode } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Loader2, ShieldCheck, LogIn, LogOut, AlertTriangle, X, CheckCircle2, UserX, Ban } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { getPendingForAudit, performNightAudit, bulkSetStatus } from "@/lib/night-audit-api";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useCheckInController } from "@/lib/check-in-flow";

/**
 * Night Audit dialog.
 *
 * Business rules:
 *  - Pending Check-Ins: check_in < business_date AND status ∉ {Checked-In, Checked-Out, Cancelled, No-Show, Stay Completed}.
 *  - Pending Check-Outs: status = Checked-In AND check_out < business_date.
 *  - No-Show button is shown only when check_out < business_date (guest didn't arrive AND stay window already past).
 *  - Check-In opens the same Room Assignment / Check-In flow used elsewhere — no redirection.
 *  - Cancel opens a confirmation; on Yes, booking → Cancelled (Due becomes ₹0), action item disappears.
 */
export function NightAuditDialog({ open, onClose, inline = false }: { open: boolean; onClose: () => void; inline?: boolean }) {
  const qc = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<{ id: string; name: string } | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["night-audit-pending"],
    queryFn: () => getPendingForAudit(),
    enabled: open,
    refetchOnWindowFocus: false,
  });

  const checkIn = useCheckInController({
    note: "From Night Audit",
    onCheckedIn: () => {
      qc.invalidateQueries({ queryKey: ["night-audit-pending"] });
      void refetch();
    },
  });

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "Checked-In" | "Checked-Out" | "Cancelled" | "No-Show" }) => {
      setBusyId(id);
      const { setBookingStatus } = await import("@/lib/bookings-api");
      const { logBookingActivity } = await import("@/lib/booking-activities-api");
      await setBookingStatus(id, status as any);
      await logBookingActivity({
        booking_id: id,
        action: status === "Checked-In" ? "check_in"
          : status === "Checked-Out" ? "check_out"
          : status === "No-Show" ? "no_show"
          : "cancelled",
        from_status: null, to_status: status,
        notes: "From Night Audit",
      });
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["bookings"] });
      qc.invalidateQueries({ queryKey: ["night-audit-pending"] });
      if (vars.status === "No-Show") toast.success("Marked as No-Show");
      else if (vars.status === "Cancelled") toast.success("Booking cancelled");
      else if (vars.status === "Checked-In") toast.success("Checked-In Successfully");
      refetch();
    },
    onSettled: () => setBusyId(null),
    onError: (e: any) => toast.error(e?.message ?? "Could not update booking"),
  });

  const bulk = useMutation({
    mutationFn: async ({ ids, status }: { ids: string[]; status: "Checked-In" | "Checked-Out" | "Cancelled" }) => {
      await bulkSetStatus(ids, status);
    },
    onSuccess: (_d, vars) => {
      toast.success(`${vars.ids.length} bookings → ${vars.status}`);
      qc.invalidateQueries({ queryKey: ["bookings"] });
      qc.invalidateQueries({ queryKey: ["night-audit-pending"] });
      refetch();
    },
    onError: (e: any) => toast.error(e?.message ?? "Bulk action failed"),
  });

  const runBulk = (ids: string[], status: "Checked-In" | "Checked-Out" | "Cancelled", verb: string) => {
    if (ids.length === 0) return;
    if (!window.confirm(`You are about to ${verb} ${ids.length} booking${ids.length === 1 ? "" : "s"}. Continue?`)) return;
    bulk.mutate({ ids, status });
  };

  // Delegate to the shared Check-In controller (OTA phone → docs → rooms → commit).
  const handleCheckIn = (bookingId: string) => {
    checkIn.start(bookingId);
  };

  const perform = useMutation({
    mutationFn: () => performNightAudit({ mode: "manual" }),
    onSuccess: (res) => {
      if (!res.ok) {
        if (res.reason === "already_done") {
          toast.success("Night Audit already performed for this Business Date");
          qc.invalidateQueries({ queryKey: ["business-date"] });
          qc.invalidateQueries({ queryKey: ["night-audit-pending"] });
          onClose();
          return;
        }
        toast.error("Cannot advance business date — pending items remain");
        refetch();
        return;
      }
      toast.success(`Night audit complete · Business date → ${res.newBusinessDate}`);
      qc.invalidateQueries({ queryKey: ["business-date"] });
      qc.invalidateQueries({ queryKey: ["night-audit-pending"] });
      onClose();
    },
    onError: (e: any) => toast.error(e?.message ?? "Night audit failed"),
  });

  if (!open) return null;

  const bd = data?.businessDate;
  const ci = data?.pendingCheckIns ?? [];
  const co = data?.pendingCheckOuts ?? [];
  const clear = !isLoading && ci.length === 0 && co.length === 0;

  const Outer: any = inline ? "div" : "div";
  const outerClass = inline
    ? ""
    : "fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm";
  const innerClass = inline
    ? "p-5 space-y-4"
    : "luxe-card rounded-xl w-full max-w-3xl p-5 space-y-4 max-h-[90vh] overflow-y-auto";

  return (
    <>
    <Outer className={outerClass} onClick={inline ? undefined : onClose}>
      <div className={innerClass} onClick={(e) => e.stopPropagation()}>
        {!inline && (
        <div className="flex items-start justify-between">
          <div>
            <h3 className="font-display text-xl flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-gold" /> Night Audit</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Current business date: <span className="font-medium text-foreground">{bd ?? "—"}</span>
            </p>
          </div>
          <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
        )}

        {isLoading && <div className="p-8 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-gold" /></div>}

        {!isLoading && (
          <>
            <Section
              title="Pending Check-Ins"
              empty="✓ No pending check-ins"
              rows={ci}
              bulk={ci.length > 0 ? (
                <>
                  <button onClick={() => runBulk(ci.map((b) => b.id), "Checked-In", "Check-In")}
                    disabled={bulk.isPending}
                    className="rounded-md gold-gradient px-2.5 py-1 text-[11px] font-medium text-charcoal disabled:opacity-50">Check-In All</button>
                  <button onClick={() => runBulk(ci.map((b) => b.id), "Cancelled", "Cancel")}
                    disabled={bulk.isPending}
                    className="rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-1 text-[11px] text-destructive disabled:opacity-50">Cancel All</button>
                </>
              ) : null}
              renderActions={(b) => {
                // No-Show is shown ONLY when checkout < business_date (stay window already past).
                const showNoShow = !!bd && b.check_out < bd;
                return (
                  <>
                    <Link to="/bookings/$id" params={{ id: b.id }} onClick={onClose}
                      className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1 text-[11px] hover:border-gold/40">
                      View
                    </Link>
                    <button
                      onClick={() => handleCheckIn(b.id)}
                      disabled={busyId === b.id}
                      className="inline-flex items-center gap-1 rounded-md gold-gradient px-2.5 py-1 text-[11px] text-charcoal font-medium disabled:opacity-60">
                      <LogIn className="h-3 w-3" /> Check-In
                    </button>
                    {showNoShow && (
                      <button
                        onClick={() => {
                          if (!window.confirm(`Mark "${b.guest_name}" as No-Show? Balance Due becomes ₹0 and the room is freed.`)) return;
                          setStatus.mutate({ id: b.id, status: "No-Show" });
                        }}
                        disabled={busyId === b.id}
                        className="inline-flex items-center gap-1 rounded-md border border-warning/40 bg-warning/10 px-2.5 py-1 text-[11px] text-warning disabled:opacity-50">
                        <UserX className="h-3 w-3" /> No-Show
                      </button>
                    )}
                    <button
                      onClick={() => setCancelTarget({ id: b.id, name: b.guest_name })}
                      disabled={busyId === b.id}
                      className="inline-flex items-center gap-1 rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-1 text-[11px] text-destructive disabled:opacity-50">
                      <Ban className="h-3 w-3" /> Cancel
                    </button>
                  </>
                );
              }}
            />
            <Section
              title="Pending Check-Outs"
              empty="✓ No pending check-outs"
              rows={co}
              bulk={co.length > 0 ? (
                <button onClick={() => runBulk(co.map((b) => b.id), "Checked-Out", "Check-Out")}
                  disabled={bulk.isPending}
                  className="rounded-md gold-gradient px-2.5 py-1 text-[11px] font-medium text-charcoal disabled:opacity-50">Check-Out All</button>
              ) : null}
              renderActions={(b) => (
                <>
                  <Link to="/bookings/$id" params={{ id: b.id }} onClick={onClose}
                    className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1 text-[11px] hover:border-gold/40">
                    View
                  </Link>
                  <button
                    onClick={() => setStatus.mutate({ id: b.id, status: "Checked-Out" })}
                    disabled={busyId === b.id}
                    className="inline-flex items-center gap-1 rounded-md gold-gradient px-2.5 py-1 text-[11px] text-charcoal font-medium disabled:opacity-50">
                    <LogOut className="h-3 w-3" /> Check-Out
                  </button>
                  <Link to="/bookings/$id" params={{ id: b.id }} onClick={onClose}
                    className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1 text-[11px] hover:border-gold/40">
                    Extend Stay
                  </Link>
                </>
              )}
            />


            <div className={cn("rounded-md border p-3 text-xs flex items-start gap-2",
              clear ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-500" : "border-warning/40 bg-warning/10 text-warning")}>
              {clear ? <CheckCircle2 className="h-4 w-4 mt-0.5" /> : <AlertTriangle className="h-4 w-4 mt-0.5" />}
              <div>
                {clear ? (
                  <>All pending items resolved. You can now advance the business date.</>
                ) : (
                  <>Business date will <span className="font-medium">not</span> advance until all pending items are resolved.</>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button onClick={onClose} className="rounded-md border border-border bg-card px-3 py-2 text-xs">Close</button>
              <button
                onClick={() => perform.mutate()}
                disabled={!clear || perform.isPending}
                className="rounded-md gold-gradient px-4 py-2 text-xs font-medium text-charcoal disabled:opacity-50">
                {perform.isPending ? "Working…" : "Perform Night Audit"}
              </button>
            </div>
          </>
        )}
      </div>
    </Outer>

    {/* Shared Check-In flow — identical to Booking page & House View (OTA phone → docs → rooms → commit). */}
    {checkIn.dialogs}

    {/* Cancel confirmation — same outcome as the booking-page cancel flow (status=Cancelled, Due=0). */}
    <AlertDialog open={!!cancelTarget} onOpenChange={(o) => { if (!o) setCancelTarget(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Are you sure you want to cancel this booking?</AlertDialogTitle>
          <AlertDialogDescription>
            {cancelTarget?.name ? <><span className="font-medium text-foreground">{cancelTarget.name}</span> — </> : null}
            The booking will be marked <span className="font-medium text-foreground">Cancelled</span>, assigned rooms become vacant and Balance Due is set to ₹0.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>No</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              if (!cancelTarget) return;
              const id = cancelTarget.id;
              setCancelTarget(null);
              setStatus.mutate({ id, status: "Cancelled" });
            }}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Yes, Cancel
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}

function Section({ title, empty, rows, renderActions, bulk }: {
  title: string;
  empty: string;
  rows: Array<{ id: string; booking_reference: string; guest_name: string; check_in: string; check_out: string; status: string; room_number?: string | null }>;
  renderActions: (b: any) => ReactNode;
  bulk?: ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-[10px] uppercase tracking-wider text-muted-foreground">{title}</h4>
        {bulk && <div className="flex items-center gap-1.5">{bulk}</div>}
      </div>
      {rows.length === 0 ? (
        <div className="text-xs text-emerald-500 italic">{empty}</div>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((b) => (
            <li key={b.id} className="rounded-md border border-border bg-secondary/30 px-3 py-2 flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">
                  <Link to="/bookings/$id" params={{ id: b.id }} className="hover:text-gold">{b.guest_name}</Link>
                  <span className="text-[11px] text-muted-foreground"> · {b.booking_reference}</span>
                </div>
                <div className="text-[11px] text-muted-foreground tabular">
                  {b.room_number ? `Room ${b.room_number} · ` : ""}{b.check_in} → {b.check_out} · {b.status}
                </div>
              </div>
              <div className="flex items-center gap-1.5">{renderActions(b)}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
