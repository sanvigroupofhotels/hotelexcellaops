/**
 * Night Audit Stepper — Reception Command Center.
 *
 * 7 steps:
 *   1. Arrivals      — pending check-ins, OTA, walk-ins, missing rooms, advance-due
 *   2. In-House      — currently occupied bookings
 *   3. Departures    — Checked-In with check_out <= business date
 *   4. Dues          — outstanding balances (arrivals + in-house + departures)
 *   5. Reconciliation— occupancy + revenue + cash variance
 *   6. Review        — final pre-close summary; exceptions + override reason
 *   7. EOD           — printable End-of-Day report
 *
 * Business Date advancement is owned solely by Close Session in the parent
 * (night-audit.tsx). This component never advances it.
 */
import { useMemo, useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  LogIn, LogOut, Ban, UserX, CalendarDays, BedDouble, Wallet, Receipt,
  ClipboardCheck, FileText, AlertTriangle, CheckCircle2, Sparkles, Loader2,
  Filter, IndianRupee, ArrowLeftRight, Printer, Download, Clock, RefreshCw,
} from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useCheckInController } from "@/lib/check-in-flow";
import { setBookingStatus } from "@/lib/bookings-api";
import { logBookingActivity } from "@/lib/booking-activities-api";
import { getOpenSession, logDecision, saveSessionDraft } from "@/lib/night-audit-sessions-api";
import { useUserRole } from "@/hooks/use-role";
import { AddBookingPaymentModal } from "@/components/add-booking-payment-modal";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

/* ------------------------------------------------------------------ */
/* Types & helpers                                                     */
/* ------------------------------------------------------------------ */

const OTA_SOURCES = new Set([
  "Booking.com", "Agoda", "MakeMyTrip", "Goibibo", "Expedia",
  "Airbnb", "Hotelzify", "OTA", "Cleartrip", "EaseMyTrip",
]);

interface BookingRow {
  id: string;
  booking_reference: string;
  guest_name: string;
  phone: string | null;
  check_in: string;
  check_out: string;
  status: string;
  room_id: string | null;
  room_number?: string | null;
  lead_source: string | null;
  amount: number;
  advance_paid: number;
  customer_id: string | null;
  created_at: string;
}

type ArrivalFilter = "all" | "ota" | "walkin" | "missing_room" | "advance_due";

function isOTA(src: string | null | undefined) {
  return !!src && OTA_SOURCES.has(src);
}
function inr(n: number) {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

/* ------------------------------------------------------------------ */
/* Step definitions                                                    */
/* ------------------------------------------------------------------ */

interface StepDef {
  key: string;
  label: string;
  icon: typeof BedDouble;
}

const STEPS: StepDef[] = [
  { key: "arrivals",       label: "Arrivals",       icon: LogIn },
  { key: "inhouse",        label: "In-House",       icon: BedDouble },
  { key: "departures",     label: "Departures",     icon: LogOut },
  { key: "dues",           label: "Dues",           icon: Wallet },
  { key: "reconcile",      label: "Reconcile",      icon: ClipboardCheck },
  { key: "review",         label: "Review",         icon: Sparkles },
  { key: "eod",            label: "EOD",            icon: FileText },
];

/* ------------------------------------------------------------------ */
/* Reconcile state container (lifted so EOD/Review can read it)        */
/* ------------------------------------------------------------------ */

interface ReconcileState {
  declaredCash: number | null;   // operator-entered counted cash
  varianceReason: string;
  acknowledged: boolean;         // operator confirmed "I've reviewed"
}
interface ReviewState {
  overrideReason: string;        // recorded when exceptions exist
}

/* ------------------------------------------------------------------ */
/* Main component                                                      */
/* ------------------------------------------------------------------ */

export function NightAuditStepper({ businessDate }: { businessDate: string }) {
  const [active, setActive] = useState<string>("arrivals");
  const { isAdmin, canManage } = useUserRole();

  // ─── shared data: arrivals & in-house ──────────────────────────────────
  const arrivals = useQuery({
    queryKey: ["na-stepper-arrivals", businessDate],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bookings" as any)
        .select("id,booking_reference,guest_name,phone,check_in,check_out,status,room_id,lead_source,amount,advance_paid,customer_id,created_at")
        .lte("check_in", businessDate)
        .not("status", "in", "(Checked-In,Checked-Out,Cancelled,Stay Completed,No-Show)")
        .order("check_in", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as BookingRow[];
    },
    enabled: !!businessDate && businessDate !== "—",
  });

  const inhouse = useQuery({
    queryKey: ["na-stepper-inhouse", businessDate],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bookings" as any)
        .select("id,booking_reference,guest_name,phone,check_in,check_out,status,room_id,lead_source,amount,advance_paid,customer_id,created_at")
        .eq("status", "Checked-In" as any)
        .order("check_out", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as BookingRow[];
    },
    enabled: !!businessDate && businessDate !== "—",
  });

  const rooms = useQuery({
    queryKey: ["na-stepper-rooms"],
    queryFn: async () => {
      const { data } = await supabase.from("rooms" as any).select("id,room_number,active");
      const m = new Map<string, string>();
      let total = 0;
      (data ?? []).forEach((r: any) => {
        m.set(r.id, r.room_number);
        if (r.active !== false) total += 1;
      });
      return { byId: m, totalActive: total };
    },
    staleTime: 5 * 60_000,
  });

  // Session (used to log decisions for actions taken inside the stepper)
  const session = useQuery({
    queryKey: ["night-audit-session", businessDate],
    queryFn: () => getOpenSession(businessDate),
    enabled: !!businessDate && businessDate !== "—",
  });
  const sessionId = session.data?.id ?? null;

  const naLog = async (
    step: string,
    action: string,
    extra: Partial<Parameters<typeof logDecision>[0]> = {},
  ) => {
    if (!sessionId) return;
    try { await logDecision({ sessionId, step, action, ...extra }); } catch (e) { /* non-fatal */ }
  };

  const decorate = <T extends { room_id: string | null }>(rs: T[] | undefined) =>
    (rs ?? []).map((r) => ({ ...r, room_number: r.room_id ? rooms.data?.byId.get(r.room_id) ?? null : null }));

  const arrivalsRows = useMemo(() => decorate(arrivals.data), [arrivals.data, rooms.data]);
  const inhouseRows  = useMemo(() => decorate(inhouse.data), [inhouse.data, rooms.data]);

  // Departures = checked-in & check_out <= business date
  const departuresRows = useMemo(
    () => inhouseRows.filter((b) => b.check_out <= businessDate),
    [inhouseRows, businessDate],
  );

  // Late-checkout heuristic: check_out date < business date (overdue)
  const lateOverdue = (b: BookingRow) => b.check_out < businessDate;

  // Dues rows (all bookings with outstanding balance currently in audit scope)
  const duesRows = useMemo(() => {
    const seen = new Set<string>();
    const all: (BookingRow & { room_number?: string | null; due: number })[] = [];
    [...arrivalsRows, ...inhouseRows].forEach((b) => {
      if (seen.has(b.id)) return;
      const due = Math.max(0, (b.amount ?? 0) - (b.advance_paid ?? 0));
      if (due > 0) { all.push({ ...b, due }); seen.add(b.id); }
    });
    return all.sort((a, z) => z.due - a.due);
  }, [arrivalsRows, inhouseRows]);

  /* ────── Reconciliation data ────── */
  const paymentsToday = useQuery({
    queryKey: ["na-stepper-payments-today", businessDate],
    queryFn: async () => {
      const start = `${businessDate}T00:00:00`;
      const end   = `${businessDate}T23:59:59.999`;
      const { data, error } = await supabase
        .from("booking_payments" as any)
        .select("amount,payment_mode,is_refund,occurred_at")
        .gte("occurred_at", start).lte("occurred_at", end);
      if (error) throw error;
      return (data ?? []) as any[];
    },
    enabled: !!businessDate && businessDate !== "—",
  });

  const cashToday = useQuery({
    queryKey: ["na-stepper-cash-today", businessDate],
    queryFn: async () => {
      const start = `${businessDate}T00:00:00`;
      const end   = `${businessDate}T23:59:59.999`;
      const { data, error } = await supabase
        .from("cash_transactions" as any)
        .select("amount,kind,active,occurred_at")
        .gte("occurred_at", start).lte("occurred_at", end)
        .eq("active", true);
      if (error) throw error;
      return (data ?? []) as any[];
    },
    enabled: !!businessDate && businessDate !== "—",
  });

  // Totals
  const totals = useMemo(() => {
    const pays = paymentsToday.data ?? [];
    let collectionsToday = 0, refundsToday = 0, cashCollectionsToday = 0;
    pays.forEach((p: any) => {
      const amt = Number(p.amount) || 0;
      if (p.is_refund) refundsToday += amt;
      else collectionsToday += amt;
      if (!p.is_refund && String(p.payment_mode).toLowerCase() === "cash") cashCollectionsToday += amt;
    });
    const cash = cashToday.data ?? [];
    let cashIn = 0, cashOut = 0, cashTxCount = 0;
    cash.forEach((t: any) => {
      const amt = Number(t.amount) || 0;
      if (t.kind === "collection") cashIn += amt;
      else cashOut += amt;
      cashTxCount += 1;
    });
    const occupied = inhouseRows.length;
    const totalRooms = rooms.data?.totalActive ?? 0;
    const vacant = Math.max(0, totalRooms - occupied);
    const occupancyPct = totalRooms > 0 ? Math.round((occupied / totalRooms) * 100) : 0;
    const totalOutstanding = duesRows.reduce((s, r) => s + r.due, 0);
    // Room revenue ~ sum amount of in-house bookings (proxy); ADR
    const roomRevenue = inhouseRows.reduce((s, b) => s + (Number(b.amount) || 0), 0);
    const adr = occupied > 0 ? Math.round(roomRevenue / occupied) : 0;
    return {
      occupied, vacant, totalRooms, occupancyPct,
      collectionsToday, refundsToday, cashCollectionsToday,
      cashIn, cashOut, cashTxCount, cashNetToday: cashIn - cashOut,
      totalOutstanding, roomRevenue, adr,
    };
  }, [paymentsToday.data, cashToday.data, inhouseRows, rooms.data, duesRows]);

  /* ────── Lifted reconcile/review state ────── */
  const [recon, setRecon] = useState<ReconcileState>({ declaredCash: null, varianceReason: "", acknowledged: false });
  const [review, setReview] = useState<ReviewState>({ overrideReason: "" });

  const cashVariance = useMemo(() => {
    if (recon.declaredCash == null) return null;
    return recon.declaredCash - totals.cashNetToday;
  }, [recon.declaredCash, totals.cashNetToday]);

  /* ------------------------------------------------------------------ */
  /* Pending counts per step                                            */
  /* ------------------------------------------------------------------ */
  const counts: Record<string, number> = {
    arrivals:   arrivalsRows.length,
    inhouse:    inhouseRows.length,
    departures: departuresRows.length,
    dues:       duesRows.length,
    reconcile:  (recon.declaredCash == null || !recon.acknowledged) ? 1 : 0,
    review:     0, // computed below
    eod:        session.data ? 0 : 1,
  };

  // Rail hint strings
  const hints: Record<string, string> = {
    arrivals:   counts.arrivals ? `${counts.arrivals} pending` : "Clear",
    inhouse:    counts.inhouse ? `${counts.inhouse} in-house` : "Clear",
    departures: counts.departures ? `${counts.departures} pending` : "Clear",
    dues:       totals.totalOutstanding > 0 ? inr(totals.totalOutstanding) : "Settled",
    reconcile:  recon.declaredCash == null
                  ? "Awaiting count"
                  : (cashVariance !== null && Math.abs(cashVariance) > 1
                      ? `Variance ${inr(Math.abs(cashVariance))}`
                      : "Balanced"),
    review:     "",
    eod:        session.data ? "Ready" : "No session",
  };

  // Exceptions feed into Review
  const exceptions = useMemo(() => {
    const list: string[] = [];
    if (counts.arrivals)    list.push(`${counts.arrivals} unresolved arrival(s)`);
    if (counts.departures)  list.push(`${counts.departures} pending departure(s)`);
    if (totals.totalOutstanding > 0) list.push(`Outstanding dues ${inr(totals.totalOutstanding)}`);
    if (cashVariance !== null && Math.abs(cashVariance) > 1)
      list.push(`Cash variance ${inr(Math.abs(cashVariance))}`);
    if (recon.declaredCash == null) list.push("Cash not yet counted");
    return list;
  }, [counts, totals, cashVariance, recon.declaredCash]);

  counts.review = exceptions.length;
  if (exceptions.length > 0 && !review.overrideReason.trim()) hints.review = `${exceptions.length} exception(s)`;
  else if (exceptions.length > 0) hints.review = "Override pending";
  else hints.review = "Ready to close";

  const totalSteps   = STEPS.length;
  const completedSteps = STEPS.filter((s) => (counts[s.key] ?? 0) === 0).length;
  const progressPct = Math.round((completedSteps / totalSteps) * 100);

  /* ------------------------------------------------------------------ */
  /* Render                                                             */
  /* ------------------------------------------------------------------ */
  return (
    <div className="space-y-4">
      {/* Stepper rail */}
      <div className="rounded-lg border border-border bg-card/60 p-3 print:hidden">
        <div className="flex items-center justify-between mb-2">
          <div className="text-[11px] text-muted-foreground">
            Session progress · <span className="text-foreground font-medium">{completedSteps}/{totalSteps}</span> clear
          </div>
          <div className="text-[11px] text-muted-foreground">{progressPct}%</div>
        </div>
        <div className="h-1.5 rounded-full bg-secondary/60 overflow-hidden mb-3">
          <div className="h-full gold-gradient transition-all" style={{ width: `${progressPct}%` }} />
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-1.5">
          {STEPS.map((s, idx) => {
            const pending = counts[s.key] ?? 0;
            const isActive = active === s.key;
            const isClear = pending === 0;
            const Icon = s.icon;
            return (
              <button
                key={s.key}
                onClick={() => setActive(s.key)}
                className={cn(
                  "flex items-center gap-2 rounded-md border px-2.5 py-2 text-left transition-colors",
                  isActive
                    ? "border-gold/60 bg-gold-soft/40 text-foreground"
                    : "border-border bg-card/30 text-muted-foreground hover:border-gold/30 hover:text-foreground",
                )}
              >
                <div className={cn(
                  "h-6 w-6 shrink-0 rounded-md flex items-center justify-center text-[10px] font-medium",
                  isClear ? "bg-emerald-500/20 text-emerald-500" : "bg-amber-500/20 text-amber-500",
                )}>
                  {isClear ? <CheckCircle2 className="h-3.5 w-3.5" /> : idx + 1}
                </div>
                <div className="min-w-0">
                  <div className="text-[11px] font-medium truncate flex items-center gap-1">
                    <Icon className="h-3 w-3" /> {s.label}
                  </div>
                  <div className={cn(
                    "text-[10px] truncate",
                    isClear ? "text-emerald-500/80" : "text-amber-500/90",
                  )}>
                    {hints[s.key]}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Active step body */}
      {active === "arrivals" && (
        <ArrivalsStep
          businessDate={businessDate}
          rows={arrivalsRows}
          loading={arrivals.isLoading}
          refetch={() => arrivals.refetch()}
          naLog={naLog}
        />
      )}
      {active === "inhouse" && (
        <InHouseStep businessDate={businessDate} rows={inhouseRows} loading={inhouse.isLoading} />
      )}
      {active === "departures" && (
        <DeparturesStep
          businessDate={businessDate}
          rows={departuresRows}
          loading={inhouse.isLoading}
          isAdmin={isAdmin || canManage}
          naLog={naLog}
          lateOverdue={lateOverdue}
        />
      )}
      {active === "dues" && (
        <DuesStep
          rows={duesRows}
          totals={totals}
          loading={arrivals.isLoading || inhouse.isLoading}
        />
      )}
      {active === "reconcile" && (
        <ReconcileStep totals={totals} state={recon} setState={setRecon} variance={cashVariance} />
      )}
      {active === "review" && (
        <ReviewStep
          counts={counts}
          exceptions={exceptions}
          state={review}
          setState={setReview}
          variance={cashVariance}
        />
      )}
      {active === "eod" && (
        <EodStep
          businessDate={businessDate}
          totals={totals}
          arrivals={arrivalsRows.length}
          inhouse={inhouseRows.length}
          departures={departuresRows.length}
          variance={cashVariance}
          recon={recon}
          exceptions={exceptions}
          overrideReason={review.overrideReason}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Step 1 — Arrivals                                                   */
/* ------------------------------------------------------------------ */

function ArrivalsStep({
  businessDate, rows, loading, refetch, naLog,
}: {
  businessDate: string;
  rows: (BookingRow & { room_number?: string | null })[];
  loading: boolean;
  refetch: () => void;
  naLog: (step: string, action: string, extra?: any) => Promise<void>;
}) {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<ArrivalFilter>("all");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<{ id: string; name: string } | null>(null);

  const checkIn = useCheckInController({
    note: "From Night Audit · Arrivals",
    onCheckedIn: (id) => {
      void naLog("arrivals", "check_in", { bookingId: id, afterStatus: "Checked-In" });
      qc.invalidateQueries({ queryKey: ["na-stepper-arrivals"] });
      qc.invalidateQueries({ queryKey: ["na-stepper-inhouse"] });
      qc.invalidateQueries({ queryKey: ["night-audit-pending"] });
      qc.invalidateQueries({ queryKey: ["night-audit-status"] });
      refetch();
    },
  });

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "Cancelled" | "No-Show" }) => {
      setBusyId(id);
      await setBookingStatus(id, status as any);
      await logBookingActivity({
        booking_id: id,
        action: status === "No-Show" ? "no_show" : "cancelled",
        from_status: null, to_status: status,
        notes: "From Night Audit · Arrivals",
      });
      await naLog("arrivals", status === "No-Show" ? "no_show" : "cancel", { bookingId: id, afterStatus: status });
    },
    onSuccess: (_d, v) => {
      toast.success(v.status === "No-Show" ? "Marked as No-Show" : "Booking cancelled");
      qc.invalidateQueries({ queryKey: ["na-stepper-arrivals"] });
      qc.invalidateQueries({ queryKey: ["night-audit-pending"] });
      qc.invalidateQueries({ queryKey: ["night-audit-status"] });
      qc.invalidateQueries({ queryKey: ["bookings"] });
    },
    onSettled: () => setBusyId(null),
    onError: (e: any) => toast.error(e?.message ?? "Could not update booking"),
  });

  const filtered = useMemo(() => rows.filter((b) => {
    switch (filter) {
      case "ota":           return isOTA(b.lead_source);
      case "walkin":        return b.lead_source === "Walk-in" || b.lead_source === "Walk In";
      case "missing_room":  return !b.room_id;
      case "advance_due":   return (b.amount - (b.advance_paid ?? 0)) > 0;
      default:              return true;
    }
  }), [rows, filter]);

  const chips: { key: ArrivalFilter; label: string; count: number }[] = [
    { key: "all",          label: "All",            count: rows.length },
    { key: "ota",          label: "OTA",            count: rows.filter((b) => isOTA(b.lead_source)).length },
    { key: "walkin",       label: "Walk-in",        count: rows.filter((b) => b.lead_source === "Walk-in" || b.lead_source === "Walk In").length },
    { key: "missing_room", label: "Missing Room",   count: rows.filter((b) => !b.room_id).length },
    { key: "advance_due",  label: "Advance Due",    count: rows.filter((b) => (b.amount - (b.advance_paid ?? 0)) > 0).length },
  ];

  return (
    <div className="rounded-lg border border-border bg-card/40 p-4 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-sm font-medium flex items-center gap-2">
            <LogIn className="h-4 w-4 text-gold" /> Arrivals
          </h2>
          <p className="text-[11px] text-muted-foreground">
            Bookings due to arrive on or before <b className="text-foreground">{businessDate}</b>, not yet checked in.
          </p>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground flex-wrap">
          <Filter className="h-3 w-3" />
          {chips.map((c) => (
            <button
              key={c.key}
              onClick={() => setFilter(c.key)}
              className={cn(
                "rounded-full border px-2.5 py-0.5 transition-colors",
                filter === c.key
                  ? "border-gold/60 bg-gold-soft/40 text-foreground"
                  : "border-border bg-card/40 hover:border-gold/30",
              )}
            >
              {c.label} <span className="opacity-60">({c.count})</span>
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="p-8 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-gold" /></div>
      ) : filtered.length === 0 ? (
        <div className="text-xs text-emerald-500 italic py-6 text-center">✓ No arrivals match this filter.</div>
      ) : (
        <ul className="space-y-1.5">
          {filtered.map((b) => {
            const advanceDue = Math.max(0, b.amount - (b.advance_paid ?? 0));
            const showNoShow = b.check_out < businessDate;
            const ota = isOTA(b.lead_source);
            const walkin = b.lead_source === "Walk-in" || b.lead_source === "Walk In";
            return (
              <li key={b.id}
                className="rounded-md border border-border bg-secondary/30 px-3 py-2 flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate flex items-center gap-2 flex-wrap">
                    <Link to="/bookings/$id" params={{ id: b.id }} className="hover:text-gold">
                      {b.guest_name}
                    </Link>
                    <span className="text-[11px] text-muted-foreground">· {b.booking_reference}</span>
                    {ota && <Badge variant="outline" className="border-blue-500/40 text-blue-500 text-[10px] h-4">OTA</Badge>}
                    {walkin && <Badge variant="outline" className="border-emerald-500/40 text-emerald-500 text-[10px] h-4">Walk-in</Badge>}
                    {!b.room_id && <Badge variant="outline" className="border-amber-500/40 text-amber-500 text-[10px] h-4">No Room</Badge>}
                    {advanceDue > 0 && (
                      <Badge variant="outline" className="border-destructive/40 text-destructive text-[10px] h-4">
                        Adv Due {inr(advanceDue)}
                      </Badge>
                    )}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    <CalendarDays className="inline h-3 w-3 mr-1" />
                    {b.check_in} → {b.check_out}
                    {b.room_number && <> · Room {b.room_number}</>}
                    {" · "}{b.status}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <Link to="/bookings/$id" params={{ id: b.id }}
                    className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1 text-[11px] hover:border-gold/40">
                    View
                  </Link>
                  <button
                    onClick={() => checkIn.start(b.id)}
                    disabled={busyId === b.id || checkIn.isWorking}
                    className="inline-flex items-center gap-1 rounded-md gold-gradient px-2.5 py-1 text-[11px] text-charcoal font-medium disabled:opacity-60">
                    <LogIn className="h-3 w-3" /> Check-In
                  </button>
                  {showNoShow && (
                    <button
                      onClick={() => {
                        if (!window.confirm(`Mark "${b.guest_name}" as No-Show?`)) return;
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
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {checkIn.dialogs}

      <AlertDialog open={!!cancelTarget} onOpenChange={(o) => { if (!o) setCancelTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this booking?</AlertDialogTitle>
            <AlertDialogDescription>
              {cancelTarget?.name && <><span className="font-medium text-foreground">{cancelTarget.name}</span> — </>}
              Marks the booking <span className="font-medium text-foreground">Cancelled</span> and frees any assigned room.
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
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Step 2 — In-House                                                   */
/* ------------------------------------------------------------------ */

type InHouseFilter = "all" | "due" | "departing_today" | "missing_room";

function InHouseStep({
  businessDate, rows, loading,
}: {
  businessDate: string;
  rows: (BookingRow & { room_number?: string | null })[];
  loading: boolean;
}) {
  const [filter, setFilter] = useState<InHouseFilter>("all");

  const filtered = useMemo(() => rows.filter((b) => {
    const due = Math.max(0, b.amount - (b.advance_paid ?? 0));
    switch (filter) {
      case "due":              return due > 0;
      case "departing_today":  return b.check_out === businessDate;
      case "missing_room":     return !b.room_id;
      default:                 return true;
    }
  }), [rows, filter, businessDate]);

  const chips: { key: InHouseFilter; label: string; count: number }[] = [
    { key: "all",              label: "All",             count: rows.length },
    { key: "due",              label: "Outstanding Due", count: rows.filter((b) => (b.amount - (b.advance_paid ?? 0)) > 0).length },
    { key: "departing_today",  label: "Departing Today", count: rows.filter((b) => b.check_out === businessDate).length },
    { key: "missing_room",     label: "Missing Room",    count: rows.filter((b) => !b.room_id).length },
  ];

  return (
    <div className="rounded-lg border border-border bg-card/40 p-4 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-sm font-medium flex items-center gap-2">
            <BedDouble className="h-4 w-4 text-gold" /> In-House
          </h2>
          <p className="text-[11px] text-muted-foreground">
            Guests currently checked in. Business Date <b className="text-foreground">{businessDate}</b>.
          </p>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground flex-wrap">
          <Filter className="h-3 w-3" />
          {chips.map((c) => (
            <button
              key={c.key}
              onClick={() => setFilter(c.key)}
              className={cn(
                "rounded-full border px-2.5 py-0.5 transition-colors",
                filter === c.key
                  ? "border-gold/60 bg-gold-soft/40 text-foreground"
                  : "border-border bg-card/40 hover:border-gold/30",
              )}
            >
              {c.label} <span className="opacity-60">({c.count})</span>
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="p-8 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-gold" /></div>
      ) : filtered.length === 0 ? (
        <div className="text-xs text-emerald-500 italic py-6 text-center">✓ No in-house guests match this filter.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr className="border-b border-border">
                <th className="text-left py-2 px-2">Room</th>
                <th className="text-left py-2 px-2">Guest</th>
                <th className="text-left py-2 px-2">Check-In</th>
                <th className="text-left py-2 px-2">Check-Out</th>
                <th className="text-right py-2 px-2">Outstanding</th>
                <th className="text-right py-2 px-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((b) => {
                const due = Math.max(0, b.amount - (b.advance_paid ?? 0));
                const departingToday = b.check_out === businessDate;
                return (
                  <tr key={b.id} className="border-b border-border/40 hover:bg-secondary/30">
                    <td className="py-2 px-2">
                      {b.room_number ? <span className="font-medium">{b.room_number}</span> : (
                        <span className="text-amber-500 inline-flex items-center gap-1">
                          <AlertTriangle className="h-3 w-3" /> —
                        </span>
                      )}
                    </td>
                    <td className="py-2 px-2 min-w-[140px]">
                      <Link to="/bookings/$id" params={{ id: b.id }} className="font-medium hover:text-gold">
                        {b.guest_name}
                      </Link>
                      <div className="text-[10px] text-muted-foreground">{b.booking_reference}</div>
                    </td>
                    <td className="py-2 px-2 tabular-nums">{b.check_in}</td>
                    <td className="py-2 px-2 tabular-nums">
                      {b.check_out}
                      {departingToday && (
                        <Badge variant="outline" className="ml-1 border-amber-500/40 text-amber-500 text-[10px] h-4">
                          Today
                        </Badge>
                      )}
                    </td>
                    <td className="py-2 px-2 text-right tabular-nums">
                      {due > 0 ? (
                        <span className="text-destructive font-medium inline-flex items-center gap-0.5">
                          <IndianRupee className="h-3 w-3" />{due.toLocaleString("en-IN")}
                        </span>
                      ) : <span className="text-emerald-500">Settled</span>}
                    </td>
                    <td className="py-2 px-2">
                      <div className="flex items-center justify-end gap-1.5">
                        <Link to="/bookings/$id" params={{ id: b.id }}
                          className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-[10px] hover:border-gold/40">
                          <Receipt className="h-3 w-3" /> Extras
                        </Link>
                        <Link to="/bookings/$id" params={{ id: b.id }}
                          className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-[10px] hover:border-gold/40">
                          <ArrowLeftRight className="h-3 w-3" /> Change Room
                        </Link>
                        <Link to="/bookings/$id" params={{ id: b.id }}
                          className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-[10px] hover:border-gold/40">
                          <CalendarDays className="h-3 w-3" /> Extend
                        </Link>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Step 3 — Departures                                                 */
/* ------------------------------------------------------------------ */

function DeparturesStep({
  businessDate, rows, loading, isAdmin, naLog, lateOverdue,
}: {
  businessDate: string;
  rows: (BookingRow & { room_number?: string | null })[];
  loading: boolean;
  isAdmin: boolean;
  naLog: (step: string, action: string, extra?: any) => Promise<void>;
  lateOverdue: (b: BookingRow) => boolean;
}) {
  const qc = useQueryClient();
  const [payTarget, setPayTarget] = useState<{ id: string; cust: string | null; due: number } | null>(null);
  const [coTarget, setCoTarget] = useState<{ id: string; name: string; due: number } | null>(null);
  const [overrideReason, setOverrideReason] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["na-stepper-inhouse"] });
    qc.invalidateQueries({ queryKey: ["na-stepper-arrivals"] });
    qc.invalidateQueries({ queryKey: ["night-audit-pending"] });
    qc.invalidateQueries({ queryKey: ["night-audit-status"] });
    qc.invalidateQueries({ queryKey: ["bookings"] });
  };

  const doCheckOut = async (id: string, beforeStatus: string, reason: string | null) => {
    setBusyId(id);
    try {
      await setBookingStatus(id, "Checked-Out" as any);
      await logBookingActivity({
        booking_id: id, action: "check_out",
        from_status: beforeStatus, to_status: "Checked-Out",
        notes: reason ? `Night Audit · Override: ${reason}` : "From Night Audit · Departures",
      });
      await naLog("departures", reason ? "check_out_override" : "check_out", {
        bookingId: id, beforeStatus, afterStatus: "Checked-Out", reason,
      });
      toast.success("Checked out");
      refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "Could not check-out");
    } finally {
      setBusyId(null);
      setCoTarget(null);
      setOverrideReason("");
    }
  };

  return (
    <div className="rounded-lg border border-border bg-card/40 p-4 space-y-3">
      <div>
        <h2 className="text-sm font-medium flex items-center gap-2">
          <LogOut className="h-4 w-4 text-gold" /> Departures
        </h2>
        <p className="text-[11px] text-muted-foreground">
          Checked-in guests with check-out on or before <b className="text-foreground">{businessDate}</b>.
        </p>
      </div>

      {loading ? (
        <div className="p-8 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-gold" /></div>
      ) : rows.length === 0 ? (
        <div className="text-xs text-emerald-500 italic py-6 text-center">✓ No pending departures.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr className="border-b border-border">
                <th className="text-left py-2 px-2">Room</th>
                <th className="text-left py-2 px-2">Guest</th>
                <th className="text-left py-2 px-2">Check-Out</th>
                <th className="text-right py-2 px-2">Due</th>
                <th className="text-left py-2 px-2">Status</th>
                <th className="text-right py-2 px-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => {
                const due = Math.max(0, b.amount - (b.advance_paid ?? 0));
                const late = lateOverdue(b);
                return (
                  <tr key={b.id} className="border-b border-border/40 hover:bg-secondary/30">
                    <td className="py-2 px-2 font-medium">{b.room_number ?? "—"}</td>
                    <td className="py-2 px-2 min-w-[140px]">
                      <Link to="/bookings/$id" params={{ id: b.id }} className="font-medium hover:text-gold">
                        {b.guest_name}
                      </Link>
                      <div className="text-[10px] text-muted-foreground">{b.booking_reference}</div>
                    </td>
                    <td className="py-2 px-2 tabular-nums">
                      {b.check_out}
                      {late && (
                        <Badge variant="outline" className="ml-1 border-amber-500/40 text-amber-500 text-[10px] h-4">
                          <Clock className="h-2.5 w-2.5 mr-0.5" /> Late
                        </Badge>
                      )}
                    </td>
                    <td className="py-2 px-2 text-right tabular-nums">
                      {due > 0 ? (
                        <span className="text-destructive font-medium">{inr(due)}</span>
                      ) : <span className="text-emerald-500">Settled</span>}
                    </td>
                    <td className="py-2 px-2 text-muted-foreground">{b.status}</td>
                    <td className="py-2 px-2">
                      <div className="flex items-center justify-end gap-1.5 flex-wrap">
                        {due > 0 && (
                          <button
                            onClick={() => setPayTarget({ id: b.id, cust: b.customer_id, due })}
                            className="inline-flex items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-[10px] text-emerald-500">
                            <Wallet className="h-3 w-3" /> Record Payment
                          </button>
                        )}
                        <button
                          onClick={() => setCoTarget({ id: b.id, name: b.guest_name, due })}
                          disabled={busyId === b.id}
                          className="inline-flex items-center gap-1 rounded-md gold-gradient px-2.5 py-1 text-[10px] text-charcoal font-medium disabled:opacity-60">
                          <LogOut className="h-3 w-3" /> Check-Out
                        </button>
                        <Link to="/bookings/$id" params={{ id: b.id }}
                          className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-[10px] hover:border-gold/40">
                          <CalendarDays className="h-3 w-3" /> Extend
                        </Link>
                        <Link to="/bookings/$id" params={{ id: b.id }}
                          className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-[10px] hover:border-gold/40">
                          <Clock className="h-3 w-3" /> Late C/O
                        </Link>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {payTarget && (
        <AddBookingPaymentModal
          bookingId={payTarget.id}
          customerId={payTarget.cust}
          maxAmount={payTarget.due}
          onClose={() => setPayTarget(null)}
          onSaved={() => {
            void naLog("departures", "payment_recorded", { bookingId: payTarget.id });
            setPayTarget(null);
            refresh();
          }}
        />
      )}

      {/* Check-Out confirm with optional override for outstanding balance */}
      <AlertDialog open={!!coTarget} onOpenChange={(o) => { if (!o) { setCoTarget(null); setOverrideReason(""); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Check-Out {coTarget?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              {coTarget && coTarget.due > 0 ? (
                <>
                  Outstanding due is <b className="text-destructive">{inr(coTarget.due)}</b>.
                  Owner/Admin may override with a mandatory reason; the override is logged.
                </>
              ) : "Mark booking as Checked-Out."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {coTarget && coTarget.due > 0 && (
            <textarea
              className="w-full bg-input/60 border border-border rounded-md px-3 py-2 text-sm"
              rows={3}
              placeholder={isAdmin ? "Override reason (required)" : "Record payment first, or escalate to admin."}
              value={overrideReason}
              onChange={(e) => setOverrideReason(e.target.value)}
              disabled={!isAdmin}
            />
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={
                !coTarget ||
                (coTarget.due > 0 && (!isAdmin || !overrideReason.trim()))
              }
              onClick={(e) => {
                e.preventDefault();
                if (!coTarget) return;
                void doCheckOut(coTarget.id, "Checked-In", coTarget.due > 0 ? overrideReason.trim() : null);
              }}>
              {coTarget && coTarget.due > 0 ? "Override & Check-Out" : "Check-Out"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Step 4 — Dues                                                       */
/* ------------------------------------------------------------------ */

function DuesStep({
  rows, totals, loading,
}: {
  rows: (BookingRow & { room_number?: string | null; due: number })[];
  totals: { totalOutstanding: number; collectionsToday: number; refundsToday: number };
  loading: boolean;
}) {
  const [payTarget, setPayTarget] = useState<{ id: string; cust: string | null; due: number } | null>(null);
  const qc = useQueryClient();

  return (
    <div className="rounded-lg border border-border bg-card/40 p-4 space-y-3">
      <div>
        <h2 className="text-sm font-medium flex items-center gap-2">
          <Wallet className="h-4 w-4 text-gold" /> Dues
        </h2>
        <p className="text-[11px] text-muted-foreground">Outstanding balances across the session.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <SummaryCard label="Total Outstanding" value={inr(totals.totalOutstanding)} tone="destructive" />
        <SummaryCard label="Guests with Due" value={String(rows.length)} />
        <SummaryCard label="Collections Today" value={inr(totals.collectionsToday)} tone="emerald" />
        <SummaryCard label="Refunds Today" value={inr(totals.refundsToday)} tone="amber" />
      </div>

      {loading ? (
        <div className="p-8 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-gold" /></div>
      ) : rows.length === 0 ? (
        <div className="text-xs text-emerald-500 italic py-6 text-center">✓ No outstanding dues.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr className="border-b border-border">
                <th className="text-left py-2 px-2">Guest</th>
                <th className="text-left py-2 px-2">Room</th>
                <th className="text-right py-2 px-2">Total</th>
                <th className="text-right py-2 px-2">Paid</th>
                <th className="text-right py-2 px-2">Balance</th>
                <th className="text-right py-2 px-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.id} className="border-b border-border/40 hover:bg-secondary/30">
                  <td className="py-2 px-2 min-w-[140px]">
                    <Link to="/bookings/$id" params={{ id: b.id }} className="font-medium hover:text-gold">
                      {b.guest_name}
                    </Link>
                    <div className="text-[10px] text-muted-foreground">{b.booking_reference} · {b.status}</div>
                  </td>
                  <td className="py-2 px-2">{b.room_number ?? "—"}</td>
                  <td className="py-2 px-2 text-right tabular-nums">{inr(b.amount)}</td>
                  <td className="py-2 px-2 text-right tabular-nums">{inr(b.advance_paid ?? 0)}</td>
                  <td className="py-2 px-2 text-right tabular-nums">
                    <span className="text-destructive font-medium">{inr(b.due)}</span>
                  </td>
                  <td className="py-2 px-2">
                    <div className="flex items-center justify-end gap-1.5 flex-wrap">
                      <button
                        onClick={() => setPayTarget({ id: b.id, cust: b.customer_id, due: b.due })}
                        className="inline-flex items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-[10px] text-emerald-500">
                        <Wallet className="h-3 w-3" /> Record Payment
                      </button>
                      <Link to="/bookings/$id" params={{ id: b.id }}
                        className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-[10px] hover:border-gold/40">
                        <RefreshCw className="h-3 w-3" /> Refund
                      </Link>
                      <Link to="/bookings/$id" params={{ id: b.id }}
                        className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-[10px] hover:border-gold/40">
                        Open
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {payTarget && (
        <AddBookingPaymentModal
          bookingId={payTarget.id}
          customerId={payTarget.cust}
          maxAmount={payTarget.due}
          onClose={() => setPayTarget(null)}
          onSaved={() => {
            setPayTarget(null);
            qc.invalidateQueries({ queryKey: ["na-stepper-arrivals"] });
            qc.invalidateQueries({ queryKey: ["na-stepper-inhouse"] });
            qc.invalidateQueries({ queryKey: ["na-stepper-payments-today"] });
          }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Step 5 — Reconciliation                                             */
/* ------------------------------------------------------------------ */

function ReconcileStep({
  totals, state, setState, variance,
}: {
  totals: {
    occupied: number; vacant: number; totalRooms: number; occupancyPct: number;
    roomRevenue: number; collectionsToday: number; totalOutstanding: number;
    cashIn: number; cashOut: number; cashTxCount: number; cashNetToday: number;
  };
  state: ReconcileState;
  setState: (s: ReconcileState) => void;
  variance: number | null;
}) {
  return (
    <div className="rounded-lg border border-border bg-card/40 p-4 space-y-4">
      <div>
        <h2 className="text-sm font-medium flex items-center gap-2">
          <ClipboardCheck className="h-4 w-4 text-gold" /> Reconciliation
        </h2>
        <p className="text-[11px] text-muted-foreground">
          Cross-check occupancy, revenue, and cash before closing the session.
        </p>
      </div>

      {/* Occupancy */}
      <div>
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">Occupancy</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <SummaryCard label="Occupied" value={String(totals.occupied)} />
          <SummaryCard label="Vacant"   value={String(totals.vacant)} />
          <SummaryCard label="Total Rooms" value={String(totals.totalRooms)} />
          <SummaryCard label="Physical Occupancy" value={`${totals.occupancyPct}%`} tone="emerald" />
        </div>
      </div>

      {/* Revenue */}
      <div>
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">Revenue</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <SummaryCard label="Room Revenue (in-house)" value={inr(totals.roomRevenue)} />
          <SummaryCard label="Payments Collected" value={inr(totals.collectionsToday)} tone="emerald" />
          <SummaryCard label="Outstanding Dues" value={inr(totals.totalOutstanding)} tone="destructive" />
          <SummaryCard label="Cash Net Today" value={inr(totals.cashNetToday)} />
        </div>
      </div>

      {/* Cash */}
      <div>
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">Cash</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <SummaryCard label="Cash In" value={inr(totals.cashIn)} tone="emerald" />
          <SummaryCard label="Cash Out" value={inr(totals.cashOut)} tone="amber" />
          <SummaryCard label="Transactions" value={String(totals.cashTxCount)} />
          <SummaryCard label="System Net" value={inr(totals.cashNetToday)} />
        </div>

        <div className="mt-3 grid md:grid-cols-3 gap-3">
          <div>
            <label className="text-[11px] text-muted-foreground">Declared Cash (counted)</label>
            <input
              type="number" min={0} step={1}
              value={state.declaredCash ?? ""}
              onChange={(e) => setState({ ...state, declaredCash: e.target.value === "" ? null : Number(e.target.value) })}
              placeholder="Enter counted cash"
              className="w-full bg-input/60 border border-border rounded-md px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-[11px] text-muted-foreground">Variance</label>
            <div className={cn(
              "px-3 py-2 rounded-md border text-sm font-medium tabular-nums",
              variance === null
                ? "border-border bg-card/40 text-muted-foreground"
                : Math.abs(variance) <= 1
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-500"
                  : "border-amber-500/40 bg-amber-500/10 text-amber-500",
            )}>
              {variance === null ? "—" : `${variance >= 0 ? "+" : "−"}${inr(Math.abs(variance))}`}
            </div>
          </div>
          <div>
            <label className="text-[11px] text-muted-foreground">
              Variance Reason {variance !== null && Math.abs(variance) > 1 && <span className="text-amber-500">(required)</span>}
            </label>
            <input
              type="text"
              value={state.varianceReason}
              onChange={(e) => setState({ ...state, varianceReason: e.target.value })}
              placeholder="e.g. ₹100 tip retained by reception"
              className="w-full bg-input/60 border border-border rounded-md px-3 py-2 text-sm"
            />
          </div>
        </div>

        <label className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={state.acknowledged}
            onChange={(e) => setState({ ...state, acknowledged: e.target.checked })}
          />
          I have reconciled cash, revenue and occupancy for {`Business Date`}.
        </label>
        <p className="text-[10px] text-muted-foreground italic">
          Cash variance does not block session closure — it is recorded with reason.
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Step 6 — Review                                                     */
/* ------------------------------------------------------------------ */

function ReviewStep({
  counts, exceptions, state, setState, variance,
}: {
  counts: Record<string, number>;
  exceptions: string[];
  state: ReviewState;
  setState: (s: ReviewState) => void;
  variance: number | null;
}) {
  const items = [
    { key: "arrivals",  label: "Arrivals Resolved",   ok: counts.arrivals === 0 },
    { key: "inhouse",   label: "In-House Verified",   ok: true },
    { key: "departures", label: "Departures Completed", ok: counts.departures === 0 },
    { key: "dues",      label: "Dues Reviewed",       ok: true },
    { key: "reconcile", label: "Reconciliation Done", ok: counts.reconcile === 0 },
  ];

  return (
    <div className="rounded-lg border border-border bg-card/40 p-4 space-y-4">
      <div>
        <h2 className="text-sm font-medium flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-gold" /> Review
        </h2>
        <p className="text-[11px] text-muted-foreground">
          Final pre-close summary. Resolve exceptions, or capture an override reason.
        </p>
      </div>

      <ul className="space-y-1.5">
        {items.map((i) => (
          <li key={i.key} className="flex items-center gap-2 text-sm">
            {i.ok ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            ) : (
              <AlertTriangle className="h-4 w-4 text-amber-500" />
            )}
            <span className={i.ok ? "" : "text-amber-500"}>{i.label}</span>
          </li>
        ))}
      </ul>

      <div className="rounded-md border border-border bg-card/40 p-3">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">Exceptions</div>
        {exceptions.length === 0 ? (
          <div className="text-xs text-emerald-500">✓ No exceptions. Ready to close session.</div>
        ) : (
          <>
            <ul className="text-xs text-amber-500 space-y-1 mb-2">
              {exceptions.map((e, i) => <li key={i}>• {e}</li>)}
            </ul>
            <label className="text-[11px] text-muted-foreground">
              Owner/Admin Override Reason <span className="text-amber-500">(required to close with exceptions)</span>
            </label>
            <textarea
              rows={3}
              className="w-full bg-input/60 border border-border rounded-md px-3 py-2 text-sm"
              value={state.overrideReason}
              onChange={(e) => setState({ overrideReason: e.target.value })}
              placeholder="Document the reason for closing with unresolved items."
            />
            <p className="text-[10px] text-muted-foreground mt-1">
              When you press Close Session, this reason is logged with actor, timestamp,
              before/after status, and the list of exceptions.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Step 7 — EOD                                                        */
/* ------------------------------------------------------------------ */

function EodStep({
  businessDate, totals, arrivals, inhouse, departures, variance, recon, exceptions, overrideReason,
}: {
  businessDate: string;
  totals: {
    occupied: number; vacant: number; totalRooms: number; occupancyPct: number;
    roomRevenue: number; collectionsToday: number; refundsToday: number;
    totalOutstanding: number; adr: number; cashIn: number; cashOut: number;
    cashTxCount: number; cashNetToday: number;
  };
  arrivals: number;
  inhouse: number;
  departures: number;
  variance: number | null;
  recon: ReconcileState;
  exceptions: string[];
  overrideReason: string;
}) {
  const onPrint = () => window.print();
  const onDownload = () => {
    const html = document.getElementById("eod-report-html")?.innerHTML ?? "";
    const blob = new Blob([`<!doctype html><meta charset="utf-8"><title>EOD ${businessDate}</title>
<style>body{font-family:system-ui,sans-serif;padding:24px;color:#111} h1{font-size:22px;margin:0 0 4px}
table{width:100%;border-collapse:collapse;margin:8px 0} th,td{border:1px solid #ddd;padding:6px 10px;text-align:left;font-size:13px}
th{background:#f5f5f5} .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:8px 0}
.card{border:1px solid #ddd;padding:8px;border-radius:6px} .label{font-size:11px;color:#666;text-transform:uppercase}
.value{font-size:16px;font-weight:600;margin-top:2px} .muted{color:#666;font-size:12px}
.warn{color:#b45309} .ok{color:#047857}</style>${html}`], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `EOD-${businessDate}.html`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="rounded-lg border border-border bg-card/40 p-4 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2 print:hidden">
        <div>
          <h2 className="text-sm font-medium flex items-center gap-2">
            <FileText className="h-4 w-4 text-gold" /> End of Day Report
          </h2>
          <p className="text-[11px] text-muted-foreground">
            Business Date <b className="text-foreground">{businessDate}</b>. Print-friendly · A4.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={onPrint} size="sm" variant="outline" className="gap-1">
            <Printer className="h-4 w-4" /> Print
          </Button>
          <Button onClick={onDownload} size="sm" variant="outline" className="gap-1">
            <Download className="h-4 w-4" /> Download HTML
          </Button>
        </div>
      </div>

      <div id="eod-report-html" className="rounded-md border border-border bg-background p-5 text-foreground print:border-0 print:p-0">
        <h1 className="text-xl font-display tracking-wide">Hotel Excella · End of Day Report</h1>
        <div className="muted text-xs text-muted-foreground mb-3">
          Business Date: <b className="text-foreground">{businessDate}</b> · Generated {new Date().toLocaleString()}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
          <Tile label="Occupancy" value={`${totals.occupancyPct}%`} />
          <Tile label="ADR" value={inr(totals.adr)} />
          <Tile label="Room Revenue" value={inr(totals.roomRevenue)} />
          <Tile label="Collections" value={inr(totals.collectionsToday)} />
          <Tile label="Refunds" value={inr(totals.refundsToday)} />
          <Tile label="Outstanding Dues" value={inr(totals.totalOutstanding)} />
          <Tile label="Cash Variance" value={variance === null ? "—" : inr(Math.abs(variance))} />
          <Tile label="Cash Net" value={inr(totals.cashNetToday)} />
        </div>

        <table className="w-full text-xs border border-border">
          <tbody>
            <tr><th className="text-left p-2 bg-secondary/40">Arrivals (pending)</th><td className="p-2 text-right">{arrivals}</td></tr>
            <tr><th className="text-left p-2 bg-secondary/40">In-House</th><td className="p-2 text-right">{inhouse}</td></tr>
            <tr><th className="text-left p-2 bg-secondary/40">Departures (pending)</th><td className="p-2 text-right">{departures}</td></tr>
            <tr><th className="text-left p-2 bg-secondary/40">Occupied / Total Rooms</th><td className="p-2 text-right">{totals.occupied} / {totals.totalRooms}</td></tr>
            <tr><th className="text-left p-2 bg-secondary/40">Declared Cash</th><td className="p-2 text-right">{recon.declaredCash == null ? "—" : inr(recon.declaredCash)}</td></tr>
            <tr><th className="text-left p-2 bg-secondary/40">Cash Transactions</th><td className="p-2 text-right">{totals.cashTxCount}</td></tr>
          </tbody>
        </table>

        {(exceptions.length > 0 || recon.varianceReason || overrideReason) && (
          <div className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs">
            <div className="font-medium text-amber-600 mb-1">Exceptions & Notes</div>
            {exceptions.length > 0 && (
              <ul className="space-y-0.5 mb-1">
                {exceptions.map((e, i) => <li key={i}>• {e}</li>)}
              </ul>
            )}
            {recon.varianceReason && <div className="muted">Cash variance reason: {recon.varianceReason}</div>}
            {overrideReason && <div className="muted">Override reason: {overrideReason}</div>}
          </div>
        )}

        <div className="muted text-[10px] text-muted-foreground mt-3 italic">
          Final report after Close Session is preserved in the session record.
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tiny shared bits                                                    */
/* ------------------------------------------------------------------ */

function SummaryCard({
  label, value, tone,
}: { label: string; value: string; tone?: "emerald" | "destructive" | "amber" }) {
  const toneCls =
    tone === "emerald" ? "text-emerald-500"
    : tone === "destructive" ? "text-destructive"
    : tone === "amber" ? "text-amber-500"
    : "text-foreground";
  return (
    <div className="rounded-md border border-border bg-card/60 p-2.5">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn("text-base font-semibold tabular-nums mt-0.5", toneCls)}>{value}</div>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="card border border-border rounded-md p-2">
      <div className="label text-[10px] uppercase text-muted-foreground tracking-wider">{label}</div>
      <div className="value text-sm font-semibold tabular-nums mt-0.5">{value}</div>
    </div>
  );
}
