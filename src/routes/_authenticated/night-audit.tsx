import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck, Lock, Unlock, Printer, RotateCcw, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

import { NightAuditStepper } from "@/components/night-audit-stepper";
import { useNightAuditStatus } from "@/hooks/use-night-audit-status";
import { useUserRole } from "@/hooks/use-role";
import {
  getOpenSession,
  openOrResumeSession,
  closeSession,
  reopenLastClosedSession,
  listDecisions,
} from "@/lib/night-audit-sessions-api";
import { getPendingForAudit } from "@/lib/night-audit-api";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/_authenticated/night-audit")({
  component: NightAuditPage,
  errorComponent: ({ error }) => (
    <div className="p-6 text-sm text-destructive">
      Failed to load Night Audit: {(error as Error)?.message}
    </div>
  ),
  notFoundComponent: () => <div className="p-6">Not found</div>,
});

function NightAuditPage() {
  const qc = useQueryClient();
  const { isAdmin, canManage } = useUserRole();
  const canCloseOrReopen = isAdmin || canManage;

  const status = useNightAuditStatus();
  const [confirmClose, setConfirmClose] = useState(false);
  const [confirmReopen, setConfirmReopen] = useState(false);
  const [reopenReason, setReopenReason] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [busy, setBusy] = useState(false);

  const businessDate = status.data?.businessDate ?? "—";
  const pendingCount = status.data?.pendingCount ?? 0;
  const sessionStatus = status.data?.sessionStatus ?? "none";

  // The current open session (if any)
  const session = useQuery({
    queryKey: ["night-audit-session", businessDate],
    queryFn: () => getOpenSession(businessDate),
    enabled: !!status.data,
  });

  // Decision log
  const decisions = useQuery({
    queryKey: ["night-audit-decisions", session.data?.id],
    queryFn: () => listDecisions(session.data!.id),
    enabled: !!session.data?.id,
  });

  // Counts for EOD totals
  const pending = useQuery({
    queryKey: ["night-audit-pending"],
    queryFn: () => getPendingForAudit(),
  });

  const onOpenSession = async () => {
    setBusy(true);
    try {
      await openOrResumeSession();
      toast.success("Session opened");
      await qc.invalidateQueries({ queryKey: ["night-audit-session"] });
      await qc.invalidateQueries({ queryKey: ["night-audit-status"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Could not open session");
    } finally {
      setBusy(false);
    }
  };

  const onCloseSession = async () => {
    if (!session.data?.id) return;
    if (pendingCount > 0 && !overrideReason.trim()) {
      toast.error("Resolve all pending items, or provide an override reason.");
      return;
    }
    setBusy(true);
    try {
      const totals = {
        pending_check_ins: pending.data?.pendingCheckIns.length ?? 0,
        pending_check_outs: pending.data?.pendingCheckOuts.length ?? 0,
      };
      const { newBusinessDate } = await closeSession({
        sessionId: session.data.id,
        totals,
        overrideReason: overrideReason.trim() || null,
        eodHtml: null,
      });
      toast.success(`Business Date advanced to ${newBusinessDate}`);
      setConfirmClose(false);
      setOverrideReason("");
      await qc.invalidateQueries({ queryKey: ["night-audit-status"] });
      await qc.invalidateQueries({ queryKey: ["night-audit-session"] });
      await qc.invalidateQueries({ queryKey: ["night-audit-pending"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Could not close session");
    } finally {
      setBusy(false);
    }
  };

  const onReopen = async () => {
    if (!reopenReason.trim()) {
      toast.error("Reason is required");
      return;
    }
    setBusy(true);
    try {
      await reopenLastClosedSession({ reason: reopenReason.trim() });
      toast.success("Last closed session reopened. Business Date rolled back.");
      setConfirmReopen(false);
      setReopenReason("");
      await qc.invalidateQueries({ queryKey: ["night-audit-status"] });
      await qc.invalidateQueries({ queryKey: ["night-audit-session"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Could not reopen session");
    } finally {
      setBusy(false);
    }
  };

  const onPrint = () => window.print();

  return (
    <div className="p-4 md:p-6 space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-md bg-gold-soft border border-gold/40 flex items-center justify-center">
            <ShieldCheck className="h-5 w-5 text-gold" />
          </div>
          <div>
            <h1 className="text-xl font-display tracking-wide">Night Audit · Reception Command Center</h1>
            <div className="text-xs text-muted-foreground">
              Business Date <b className="text-foreground">{businessDate}</b> ·{" "}
              Session{" "}
              <b className={sessionStatus === "open" ? "text-emerald-500" : "text-muted-foreground"}>
                {sessionStatus === "open" ? "OPEN" : "Not started"}
              </b>{" "}
              · Pending <b className="text-foreground">{pendingCount}</b>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {sessionStatus === "none" && canCloseOrReopen && (
            <Button onClick={onOpenSession} disabled={busy} size="sm" className="gap-1">
              <Unlock className="h-4 w-4" /> Open Session
            </Button>
          )}
          {sessionStatus === "open" && canCloseOrReopen && (
            <Button onClick={() => setConfirmClose(true)} disabled={busy} size="sm" className="gap-1">
              <Lock className="h-4 w-4" /> Close Session
            </Button>
          )}
          {canCloseOrReopen && (
            <Button onClick={() => setConfirmReopen(true)} disabled={busy} variant="outline" size="sm" className="gap-1">
              <RotateCcw className="h-4 w-4" /> Reopen Last
            </Button>
          )}
          <Button onClick={onPrint} variant="outline" size="sm" className="gap-1">
            <Printer className="h-4 w-4" /> EOD Print
          </Button>
        </div>
      </div>

      {/* Step 1-4 — Arrivals, In-House, Departures, Dues — currently shown via existing dialog content embedded as a section. */}
      <div className="rounded-lg border border-border bg-card/40 print:border-0">
        <NightAuditDialog open={true} onClose={() => navigate({ to: "/" })} />
      </div>

      {/* Decisions log */}
      <div className="rounded-lg border border-border bg-card/40 p-4 print:border-0">
        <div className="text-sm font-medium mb-2">Decision Log</div>
        {decisions.isLoading ? (
          <div className="text-xs text-muted-foreground">Loading…</div>
        ) : (decisions.data?.length ?? 0) === 0 ? (
          <div className="text-xs text-muted-foreground">No decisions yet.</div>
        ) : (
          <ul className="space-y-1 text-xs">
            {decisions.data!.map((d) => (
              <li key={d.id} className="flex items-start gap-2 border-b border-border/40 pb-1">
                <span className="text-muted-foreground tabular-nums">
                  {new Date(d.created_at).toLocaleString()}
                </span>
                <span className="font-medium">{d.action}</span>
                {d.before_status && d.after_status && (
                  <span className="text-muted-foreground">
                    {d.before_status} → {d.after_status}
                  </span>
                )}
                {d.reason && <span className="text-amber-500">· {d.reason}</span>}
                {d.actor_name && (
                  <span className="ml-auto text-muted-foreground">by {d.actor_name}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Close confirmation */}
      <AlertDialog open={confirmClose} onOpenChange={(o) => !o && setConfirmClose(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Lock className="h-4 w-4" /> Close Session & Advance Business Date?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Business Date will move from <b>{businessDate}</b> forward by one day.
              {pendingCount > 0 && (
                <span className="block mt-2 text-amber-500 flex items-start gap-1">
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>
                    {pendingCount} pending item(s) remain. Provide an override reason
                    to close anyway.
                  </span>
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {pendingCount > 0 && (
            <textarea
              className="w-full bg-input/60 border border-border rounded-md px-3 py-2 text-sm"
              rows={3}
              placeholder="Override reason (required when unresolved items exist)"
              value={overrideReason}
              onChange={(e) => setOverrideReason(e.target.value)}
            />
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={(e) => { e.preventDefault(); void onCloseSession(); }}>
              {busy ? "Closing…" : "Close & Advance"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Reopen confirmation */}
      <AlertDialog open={confirmReopen} onOpenChange={(o) => !o && setConfirmReopen(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reopen Last Closed Session?</AlertDialogTitle>
            <AlertDialogDescription>
              Business Date will roll back by one day. A reason is required and will
              be recorded in the decision log.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <textarea
            className="w-full bg-input/60 border border-border rounded-md px-3 py-2 text-sm"
            rows={3}
            placeholder="Reason for reopening"
            value={reopenReason}
            onChange={(e) => setReopenReason(e.target.value)}
          />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={(e) => { e.preventDefault(); void onReopen(); }}>
              {busy ? "Reopening…" : "Reopen"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
