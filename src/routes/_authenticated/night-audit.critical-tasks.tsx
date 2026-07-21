import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ChevronRight, Hand, ExternalLink, X, IndianRupee, Loader2, CalendarCheck, CheckCircle2, ArrowRight, AlertTriangle, Info } from "lucide-react";
import { toast } from "sonner";

import { EodShell } from "@/components/eod-shell";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useCheckInController } from "@/lib/check-in-flow";
import { getPendingForAudit } from "@/lib/night-audit-api";
import { listBookings, setBookingStatus } from "@/lib/bookings-api";
import { listAllChargeTotals } from "@/lib/booking-charges-api";
import { logBookingActivity } from "@/lib/booking-activities-api";
import { listRooms } from "@/lib/rooms-api";
import { AddBookingPaymentModal } from "@/components/add-booking-payment-modal";
import { performNightAuditNow } from "@/lib/perform-night-audit";

type Tab = "checkins" | "checkouts";

export const Route = createFileRoute("/_authenticated/night-audit/critical-tasks")({
  validateSearch: (s: Record<string, unknown>) => ({
    tab: s.tab === "checkouts" ? "checkouts" : "checkins",
  }),
  component: CriticalTasksPage,
});

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
function fmtDate(ymd?: string | null): string {
  if (!ymd) return "—";
  return new Date(ymd + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function CriticalTasksPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { tab } = Route.useSearch();
  const activeTab = (tab as Tab) ?? "checkins";

  const pending = useQuery({ queryKey: ["night-audit-pending"], queryFn: () => getPendingForAudit() });
  const bookings = useQuery({ queryKey: ["bookings"], queryFn: listBookings });
  const charges = useQuery({ queryKey: ["all-charge-totals"], queryFn: listAllChargeTotals });
  const rooms = useQuery({ queryKey: ["rooms-ct"], queryFn: () => listRooms() });

  const checkIn = useCheckInController({
    onCheckedIn: () => {
      qc.invalidateQueries({ queryKey: ["night-audit-pending"] });
      qc.invalidateQueries({ queryKey: ["bookings"] });
    },
  });

  const [cancelId, setCancelId] = useState<string | null>(null);
  const [coId, setCoId] = useState<string | null>(null);
  const [payFor, setPayFor] = useState<{ id: string; customerId: string | null; maxAmount: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingDialog, setPendingDialog] = useState<{ ci: number; co: number } | null>(null);
  const [successDialog, setSuccessDialog] = useState<{ prev: string; next: string } | null>(null);

  const roomMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rooms.data ?? []) m.set(r.id, r.room_number);
    return m;
  }, [rooms.data]);

  const chargeTotals = (charges.data ?? {}) as Record<string, number>;
  const bookingById = useMemo(() => {
    const m = new Map<string, any>();
    for (const b of bookings.data ?? []) m.set(b.id, b);
    return m;
  }, [bookings.data]);

  const due = (id: string): number => {
    const b = bookingById.get(id);
    if (!b) return 0;
    const total = Number(b.amount ?? 0) + Number(chargeTotals[b.id] ?? 0);
    const paid = Number(b.advance_paid ?? 0);
    return Math.max(0, total - paid);
  };

  const ciList = pending.data?.pendingCheckIns ?? [];
  const coList = pending.data?.pendingCheckOuts ?? [];
  const ciCount = ciList.length;
  const coCount = coList.length;

  const onCancel = async () => {
    if (!cancelId) return;
    setBusy(true);
    try {
      await setBookingStatus(cancelId, "Cancelled" as any);
      await logBookingActivity({ booking_id: cancelId, action: "status_changed", summary: "Cancelled from Critical Tasks" } as any);
      toast.success("Booking cancelled");
      setCancelId(null);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["night-audit-pending"] }),
        qc.invalidateQueries({ queryKey: ["bookings"] }),
      ]);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not cancel");
    } finally { setBusy(false); }
  };

  const onCheckOut = async () => {
    if (!coId) return;
    setBusy(true);
    try {
      await setBookingStatus(coId, "Checked-Out" as any);
      await logBookingActivity({ booking_id: coId, action: "status_changed", summary: "Checked-Out from Critical Tasks" } as any);
      toast.success("Guest checked out");
      setCoId(null);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["night-audit-pending"] }),
        qc.invalidateQueries({ queryKey: ["bookings"] }),
      ]);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not check out");
    } finally { setBusy(false); }
  };

  const onPerform = async () => {
    setBusy(true);
    try {
      const result = await performNightAuditNow();
      if (!result.ok) {
        setPendingDialog({ ci: result.pendingCheckIns ?? 0, co: result.pendingCheckOuts ?? 0 });
        return;
      }
      // UAT-049: broad invalidation so every Business Date-derived cache
      // refreshes without a manual reload.
      await qc.invalidateQueries();
      setSuccessDialog({ prev: result.previousBusinessDate!, next: result.newBusinessDate! });
    } catch (e: any) {
      toast.error(e?.message ?? "Could not perform Night Audit");
    } finally { setBusy(false); }
  };

  const setTab = (t: Tab) => navigate({ to: "/night-audit/critical-tasks", search: { tab: t } });

  const bothEmpty = ciCount === 0 && coCount === 0 && !pending.isLoading;

  return (
    <EodShell title="Critical Tasks">
      {/* Tabs */}
      <div className="flex border-b border-border">
        <button
          onClick={() => setTab("checkins")}
          className={`flex-1 py-3 text-sm font-medium border-b-2 transition ${
            activeTab === "checkins" ? "border-gold text-gold" : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          Pending Check-ins ({ciCount})
        </button>
        <button
          onClick={() => setTab("checkouts")}
          className={`flex-1 py-3 text-sm font-medium border-b-2 transition ${
            activeTab === "checkouts" ? "border-gold text-gold" : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          Pending Check-outs ({coCount})
        </button>
      </div>

      {/* Content */}
      {pending.isLoading ? (
        <div className="py-16 flex items-center justify-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : activeTab === "checkins" ? (
        ciCount === 0 ? (
          <EmptyState label="No Pending Check-ins" sub="All check-ins are completed." />
        ) : (
          <ul className="space-y-2">
            {ciList.map((row) => {
              const b = bookingById.get(row.id);
              const dueAmt = due(row.id);
              return (
                <li key={row.id} className="rounded-lg border border-border bg-card/40 p-3">
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{row.guest_name}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {b?.phone ?? "—"} · {row.booking_reference}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        Check-in: {fmtDate(row.check_in)} · Room: {row.room_number ?? "—"}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Due</div>
                      <div className={`text-sm font-semibold ${dueAmt > 0 ? "text-rose-500" : "text-emerald-500"}`}>{inr(dueAmt)}</div>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button size="sm" className="bg-gold text-charcoal hover:bg-gold/90" onClick={() => checkIn.start(row.id)} disabled={checkIn.isWorking}>
                      Check-In
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setCancelId(row.id)}>
                      <X className="h-3.5 w-3.5 mr-1" /> Cancel
                    </Button>
                    <Link to="/bookings/$id" params={{ id: row.id }} className="inline-flex items-center text-xs text-muted-foreground hover:text-foreground gap-1 ml-auto">
                      <ExternalLink className="h-3.5 w-3.5" /> Open
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        )
      ) : coCount === 0 ? (
        <EmptyState label="No Pending Check-outs" sub="All check-outs are completed." />
      ) : (
        <ul className="space-y-2">
          {coList.map((row) => {
            const b = bookingById.get(row.id);
            const dueAmt = due(row.id);
            return (
              <li key={row.id} className="rounded-lg border border-border bg-card/40 p-3">
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{row.guest_name}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      Room {row.room_number ?? "—"} · {row.booking_reference}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      Check-out: {fmtDate(row.check_out)}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Outstanding</div>
                    <div className={`text-sm font-semibold ${dueAmt > 0 ? "text-rose-500" : "text-emerald-500"}`}>{inr(dueAmt)}</div>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" className="bg-gold text-charcoal hover:bg-gold/90" onClick={() => setCoId(row.id)} disabled={busy}>
                    Check-Out
                  </Button>
                  {dueAmt > 0 && b && (
                    <Button size="sm" variant="outline" onClick={() => setPayFor({ id: row.id, customerId: b.customer_id, maxAmount: dueAmt })}>
                      <IndianRupee className="h-3.5 w-3.5 mr-1" /> Record Payment
                    </Button>
                  )}
                  <Link to="/bookings/$id" params={{ id: row.id }} className="inline-flex items-center text-xs text-muted-foreground hover:text-foreground gap-1 ml-auto">
                    <ExternalLink className="h-3.5 w-3.5" /> Open
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Both-empty CTA */}
      {bothEmpty && (
        <>
          <div className="rounded-md border border-sky-500/30 bg-sky-500/5 text-sky-700 dark:text-sky-300 px-3 py-2 text-xs flex items-center gap-2">
            <Info className="h-3.5 w-3.5 shrink-0" />
            No Pending Tasks. You can perform Night Audit now.
          </div>
          <Button onClick={onPerform} disabled={busy} size="lg" className="w-full h-12 gap-2 bg-gold text-charcoal hover:bg-gold/90 font-medium">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Hand className="h-4 w-4" />}
            Perform Night Audit
          </Button>
        </>
      )}

      {/* Shared check-in dialogs */}
      {checkIn.dialogs}

      {/* Cancel confirm */}
      <AlertDialog open={!!cancelId} onOpenChange={(o) => !o && setCancelId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this booking?</AlertDialogTitle>
            <AlertDialogDescription>This will set the booking status to Cancelled.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Keep</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={(e) => { e.preventDefault(); void onCancel(); }}>
              {busy ? "Cancelling…" : "Cancel Booking"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Check-out confirm */}
      <AlertDialog open={!!coId} onOpenChange={(o) => !o && setCoId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2"><CalendarCheck className="h-4 w-4" /> Check-Out Guest?</AlertDialogTitle>
            <AlertDialogDescription>
              {coId && due(coId) > 0
                ? `Outstanding balance is ${inr(due(coId))}. You can also record payment first.`
                : "Mark this stay as checked out?"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={(e) => { e.preventDefault(); void onCheckOut(); }}>
              {busy ? "Working…" : "Confirm Check-Out"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Record payment */}
      {payFor && (
        <AddBookingPaymentModal
          bookingId={payFor.id}
          customerId={payFor.customerId}
          maxAmount={payFor.maxAmount}
          onClose={() => setPayFor(null)}
          onSaved={() => {
            setPayFor(null);
            qc.invalidateQueries({ queryKey: ["bookings"] });
            qc.invalidateQueries({ queryKey: ["all-charge-totals"] });
          }}
        />
      )}

      {/* Pending block dialog */}
      <AlertDialog open={!!pendingDialog} onOpenChange={(o) => !o && setPendingDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" /> Cannot Perform Night Audit
            </AlertDialogTitle>
            <AlertDialogDescription>
              Please resolve pending check-ins and check-outs before performing Night Audit.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Close</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Success */}
      <AlertDialog open={!!successDialog} onOpenChange={(o) => !o && setSuccessDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex flex-col items-center gap-3 pt-2">
              <span className="h-14 w-14 rounded-full bg-emerald-500/15 flex items-center justify-center">
                <CheckCircle2 className="h-8 w-8 text-emerald-500" />
              </span>
              <span className="text-emerald-600 dark:text-emerald-400">Night Audit Completed Successfully!</span>
            </AlertDialogTitle>
            <AlertDialogDescription className="text-center">Business Date has been advanced.</AlertDialogDescription>
          </AlertDialogHeader>
          {successDialog && (
            <div className="rounded-md border border-border p-3 grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-sm">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Previous Business Date</div>
                <div className="font-medium">{fmtDate(successDialog.prev)}</div>
              </div>
              <ArrowRight className="h-4 w-4 text-gold" />
              <div className="text-right">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">New Business Date</div>
                <div className="font-medium">{fmtDate(successDialog.next)}</div>
              </div>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setSuccessDialog(null)}>Close</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); setSuccessDialog(null); navigate({ to: "/night-audit/eod-report" }); }}
              className="bg-gold text-charcoal hover:bg-gold/90"
            >
              View End of Day Report
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </EodShell>
  );
}

function EmptyState({ label, sub }: { label: string; sub: string }) {
  return (
    <div className="py-12 flex flex-col items-center justify-center text-center">
      <div className="h-16 w-16 rounded-full bg-muted/40 flex items-center justify-center mb-3">
        <CalendarCheck className="h-7 w-7 text-muted-foreground" />
      </div>
      <div className="text-base font-medium">{label}</div>
      <div className="text-xs text-muted-foreground mt-1">{sub}</div>
    </div>
  );
}
