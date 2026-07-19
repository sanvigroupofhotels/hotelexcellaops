import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowRight, ChevronRight, Hand, Info, LogIn, LogOut, IndianRupee, CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { EodShell } from "@/components/eod-shell";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { getPendingForAudit } from "@/lib/night-audit-api";
import { listBookings } from "@/lib/bookings-api";
import { listAllChargeTotals } from "@/lib/booking-charges-api";
import { performNightAuditNow } from "@/lib/perform-night-audit";

export const Route = createFileRoute("/_authenticated/night-audit/")({
  component: NightAuditDashboard,
});

function fmtDate(ymd?: string): string {
  if (!ymd) return "—";
  return new Date(ymd + "T00:00:00").toLocaleDateString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
  });
}

function nextDay(ymd?: string): string {
  if (!ymd) return "—";
  const d = new Date(ymd + "T00:00:00");
  d.setDate(d.getDate() + 1);
  const next = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return fmtDate(next);
}

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

function NightAuditDashboard() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState("");
  const [pendingDialog, setPendingDialog] = useState<{ ci: number; co: number } | null>(null);
  const [successDialog, setSuccessDialog] = useState<{ prev: string; next: string } | null>(null);

  const pending = useQuery({ queryKey: ["night-audit-pending"], queryFn: () => getPendingForAudit() });
  const bookings = useQuery({ queryKey: ["bookings"], queryFn: listBookings });
  const charges = useQuery({ queryKey: ["all-charge-totals"], queryFn: listAllChargeTotals });

  const businessDate = pending.data?.businessDate;
  const ciCount = pending.data?.pendingCheckIns.length ?? 0;
  const coCount = pending.data?.pendingCheckOuts.length ?? 0;

  // Outstanding dues (informational only)
  const totals = (charges.data ?? {}) as Record<string, number>;
  const outstanding = (bookings.data ?? [])
    .filter((b) => b.status !== "Cancelled" && b.status !== "No-Show" && b.status !== "Draft")
    .reduce((sum, b) => {
      const amt = Number(b.amount ?? 0) + Number(totals[b.id] ?? 0);
      const paid = Number(b.advance_paid ?? 0);
      return sum + Math.max(0, amt - paid);
    }, 0);

  const onPerform = async () => {
    setBusy(true);
    try {
      const result = await performNightAuditNow({ notes });
      if (!result.ok) {
        setPendingDialog({ ci: result.pendingCheckIns ?? 0, co: result.pendingCheckOuts ?? 0 });
        return;
      }
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["night-audit-pending"] }),
        qc.invalidateQueries({ queryKey: ["night-audit-status"] }),
        qc.invalidateQueries({ queryKey: ["bookings"] }),
      ]);
      setSuccessDialog({ prev: result.previousBusinessDate!, next: result.newBusinessDate! });
    } catch (e: any) {
      toast.error(e?.message ?? "Could not perform Night Audit");
    } finally {
      setBusy(false);
    }
  };

  return (
    <EodShell title="Night Audit">
      {/* Business date arrow card */}
      <div className="rounded-lg border border-border bg-card/40 p-4">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Business Date (Today)</div>
            <div className="text-base font-medium">{fmtDate(businessDate)}</div>
          </div>
          <ArrowRight className="h-5 w-5 text-gold shrink-0" />
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Next Business Date</div>
            <div className="text-base font-medium">{nextDay(businessDate)}</div>
          </div>
        </div>
      </div>

      {/* Critical Tasks */}
      <div>
        <div className="text-sm font-medium mb-2">Critical Tasks</div>
        <div className="space-y-2">
          <CriticalCard
            to="/night-audit/critical-tasks"
            tone="emerald"
            icon={<LogIn className="h-4 w-4" />}
            title="Pending Check-ins"
            subtitle="Complete all pending check-ins"
            badge={ciCount}
          />
          <CriticalCard
            to="/night-audit/critical-tasks"
            search={{ tab: "checkouts" }}
            tone="amber"
            icon={<LogOut className="h-4 w-4" />}
            title="Pending Check-outs"
            subtitle="Complete all pending check-outs"
            badge={coCount}
          />
          <CriticalCard
            to="/dues"
            tone="rose"
            icon={<IndianRupee className="h-4 w-4" />}
            title="Outstanding Dues (Till Date)"
            subtitle="Collect all pending payments"
            value={outstanding > 0 ? inr(outstanding) : "₹0"}
          />
        </div>
      </div>

      {/* Info banner — dues never block */}
      <div className="rounded-md border border-sky-500/30 bg-sky-500/5 text-sky-700 dark:text-sky-300 px-3 py-2 text-xs flex items-center gap-2">
        <Info className="h-3.5 w-3.5 shrink-0" />
        Dues will not block Night Audit. You can proceed.
      </div>

      {/* Optional operational notes — appears in Audit History & EOD Report */}
      <div className="rounded-lg border border-border bg-card/40 p-4 space-y-2">
        <Label htmlFor="audit-notes" className="text-xs">Notes (optional)</Label>
        <Textarea
          id="audit-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="e.g. Generator failed 2pm–4pm · Room 203 AC under maintenance · Late checkout approved for Room 104"
          className="text-sm"
        />
        <p className="text-[10px] text-muted-foreground">These notes will appear in Audit History and the End of Day Report for {fmtDate(businessDate)}.</p>
      </div>

      {/* Perform Night Audit CTA */}
      <Button
        onClick={onPerform}
        disabled={busy || pending.isLoading}
        size="lg"
        className="w-full h-12 gap-2 bg-gold text-charcoal hover:bg-gold/90 font-medium"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Hand className="h-4 w-4" />}
        Perform Night Audit
      </Button>

      {/* Pending block dialog */}
      <AlertDialog open={!!pendingDialog} onOpenChange={(o) => !o && setPendingDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" /> Cannot Perform Night Audit
            </AlertDialogTitle>
            <AlertDialogDescription>
              Business Date <span className="font-medium text-foreground">{fmtDate(businessDate)}</span> has unresolved
              activity. Please resolve all pending check-ins and overdue check-outs before advancing to{" "}
              <span className="font-medium text-foreground">{nextDay(businessDate)}</span>.
              {pendingDialog && (
                <span className="block mt-2 text-foreground">
                  {pendingDialog.ci} pending check-in{pendingDialog.ci === 1 ? "" : "s"} ·{" "}
                  {pendingDialog.co} overdue check-out{pendingDialog.co === 1 ? "" : "s"}
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Close</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); setPendingDialog(null); navigate({ to: "/night-audit/critical-tasks" }); }}
            >
              Review Critical Tasks
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Success dialog */}
      <AlertDialog open={!!successDialog} onOpenChange={(o) => !o && setSuccessDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex flex-col items-center gap-3 pt-2">
              <span className="h-14 w-14 rounded-full bg-emerald-500/15 flex items-center justify-center">
                <CheckCircle2 className="h-8 w-8 text-emerald-500" />
              </span>
              <span className="text-emerald-600 dark:text-emerald-400">Night Audit Completed Successfully!</span>
            </AlertDialogTitle>
            <AlertDialogDescription className="text-center">
              Business Date has been advanced.
            </AlertDialogDescription>
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

function CriticalCard({
  to, search, tone, icon, title, subtitle, badge, value,
}: {
  to: string;
  search?: Record<string, string>;
  tone: "emerald" | "amber" | "rose";
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  badge?: number;
  value?: string;
}) {
  const toneMap = {
    emerald: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
    amber:   "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30",
    rose:    "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/30",
  } as const;
  const badgeMap = {
    emerald: "bg-emerald-500 text-white",
    amber: "bg-amber-500 text-white",
    rose: "bg-rose-500 text-white",
  } as const;
  return (
    <Link to={to as any} search={search as any} className="block group">
      <div className="flex items-center gap-3 rounded-lg border border-border bg-card/40 p-3 hover:border-gold/40 transition">
        <div className={`h-10 w-10 rounded-md border flex items-center justify-center ${toneMap[tone]}`}>
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate">{title}</div>
          <div className="text-xs text-muted-foreground truncate">{subtitle}</div>
        </div>
        {typeof badge === "number" ? (
          <span className={`min-w-[28px] h-7 px-2 rounded-full text-xs font-semibold inline-flex items-center justify-center ${badgeMap[tone]}`}>
            {badge}
          </span>
        ) : value ? (
          <span className={`text-sm font-semibold ${tone === "rose" ? "text-rose-500" : ""}`}>{value}</span>
        ) : null}
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
      </div>
    </Link>
  );
}
