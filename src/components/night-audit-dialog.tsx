import { useState, type ReactNode } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Loader2, ShieldCheck, LogIn, LogOut, AlertTriangle, X, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { getPendingForAudit, performNightAudit, bulkSetStatus } from "@/lib/night-audit-api";

/**
 * Night Audit dialog.
 * - Lists pending check-ins (status not Checked-In/-Out/Cancelled AND check_in ≤ business date).
 * - Lists pending check-outs (status = Checked-In AND check_out ≤ business date).
 * - Quick actions: Check-In / Cancel Booking / Check-Out.
 * - "Perform Night Audit" is only enabled when both lists are empty; it then
 *   advances the business date by +1 day.
 */
export function NightAuditDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["night-audit-pending"],
    queryFn: () => getPendingForAudit(),
    enabled: open,
    refetchOnWindowFocus: false,
  });

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "Checked-In" | "Checked-Out" | "Cancelled" }) => {
      setBusyId(id);
      await setBookingStatus(id, status as any);
      await logBookingActivity({
        booking_id: id,
        action: status === "Checked-In" ? "check_in" : status === "Checked-Out" ? "check_out" : "cancelled",
        from_status: null, to_status: status,
        notes: "From Night Audit",
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bookings"] });
      qc.invalidateQueries({ queryKey: ["night-audit-pending"] });
      refetch();
    },
    onSettled: () => setBusyId(null),
    onError: (e: any) => toast.error(e?.message ?? "Could not update booking"),
  });

  const perform = useMutation({
    mutationFn: () => performNightAudit({ mode: "manual" }),
    onSuccess: (res) => {
      if (!res.ok) {
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

  const ci = data?.pendingCheckIns ?? [];
  const co = data?.pendingCheckOuts ?? [];
  const clear = !isLoading && ci.length === 0 && co.length === 0;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="luxe-card rounded-xl w-full max-w-3xl p-5 space-y-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div>
            <h3 className="font-display text-xl flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-gold" /> Night Audit</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Current business date: <span className="font-medium text-foreground">{data?.businessDate ?? "—"}</span>
            </p>
          </div>
          <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>

        {isLoading && <div className="p-8 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-gold" /></div>}

        {!isLoading && (
          <>
            <Section
              title="Pending Check-Ins"
              empty="✓ No pending check-ins"
              rows={ci}
              renderActions={(b) => (
                <>
                  <button
                    onClick={() => setStatus.mutate({ id: b.id, status: "Checked-In" })}
                    disabled={busyId === b.id}
                    className="inline-flex items-center gap-1 rounded-md gold-gradient px-2.5 py-1 text-[11px] text-charcoal font-medium disabled:opacity-50">
                    <LogIn className="h-3 w-3" /> Check-In
                  </button>
                  <button
                    onClick={() => setStatus.mutate({ id: b.id, status: "Cancelled" })}
                    disabled={busyId === b.id}
                    className="inline-flex items-center gap-1 rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-1 text-[11px] text-destructive disabled:opacity-50">
                    Cancel
                  </button>
                </>
              )}
            />
            <Section
              title="Pending Check-Outs"
              empty="✓ No pending check-outs"
              rows={co}
              renderActions={(b) => (
                <>
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
    </div>
  );
}

function Section({ title, empty, rows, renderActions }: {
  title: string;
  empty: string;
  rows: Array<{ id: string; booking_reference: string; guest_name: string; check_in: string; check_out: string; status: string; room_number?: string | null }>;
  renderActions: (b: any) => ReactNode;
}) {
  return (
    <div>
      <h4 className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">{title}</h4>
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
