/**
 * Night Audit Stepper — Reception Command Center (Phase 2A shell).
 *
 * Steps:
 *   1. Arrivals      — pending check-ins, today's arrivals, OTA, walk-ins, missing rooms, advance-due
 *   2. In-House      — currently occupied bookings; room, dates, due, extras
 *   3. Departures    — placeholder
 *   4. Dues          — placeholder
 *   5. Reconciliation— placeholder
 *   6. Review        — placeholder
 *   7. EOD           — placeholder
 *
 * Business Date advancement is NOT performed here. It is owned solely by
 * the Close Session action on the Night Audit page header.
 */
import { useMemo, useState, type ReactNode } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  LogIn, LogOut, Ban, UserX, CalendarDays, BedDouble, Wallet, Receipt,
  ClipboardCheck, FileText, AlertTriangle, CheckCircle2, Sparkles, Loader2,
  Filter, IndianRupee, ArrowLeftRight,
} from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useCheckInController } from "@/lib/check-in-flow";
import { setBookingStatus } from "@/lib/bookings-api";
import { logBookingActivity } from "@/lib/booking-activities-api";
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

interface ArrivalRow {
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
  created_at: string;
}

interface InHouseRow extends ArrivalRow {}

type ArrivalFilter = "all" | "ota" | "walkin" | "missing_room" | "advance_due";

function isOTA(src: string | null | undefined) {
  return !!src && OTA_SOURCES.has(src);
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
  { key: "departures",    label: "Departures",     icon: LogOut },
  { key: "dues",           label: "Dues",           icon: Wallet },
  { key: "reconcile",      label: "Reconcile",      icon: ClipboardCheck },
  { key: "review",         label: "Review",         icon: Sparkles },
  { key: "eod",            label: "EOD",            icon: FileText },
];

/* ------------------------------------------------------------------ */
/* Main component                                                      */
/* ------------------------------------------------------------------ */

export function NightAuditStepper({ businessDate }: { businessDate: string }) {
  const [active, setActive] = useState<string>("arrivals");

  // ─── shared data: arrivals & in-house ──────────────────────────────────
  const arrivals = useQuery({
    queryKey: ["na-stepper-arrivals", businessDate],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bookings" as any)
        .select("id,booking_reference,guest_name,phone,check_in,check_out,status,room_id,lead_source,amount,advance_paid,created_at")
        .lte("check_in", businessDate)
        .not("status", "in", "(Checked-In,Checked-Out,Cancelled,Stay Completed,No-Show)")
        .order("check_in", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as ArrivalRow[];
    },
    enabled: !!businessDate && businessDate !== "—",
  });

  const inhouse = useQuery({
    queryKey: ["na-stepper-inhouse", businessDate],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bookings" as any)
        .select("id,booking_reference,guest_name,phone,check_in,check_out,status,room_id,lead_source,amount,advance_paid,created_at")
        .eq("status", "Checked-In" as any)
        .order("check_out", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as InHouseRow[];
    },
    enabled: !!businessDate && businessDate !== "—",
  });

  // Room number map for both lists.
  const rooms = useQuery({
    queryKey: ["na-stepper-rooms"],
    queryFn: async () => {
      const { data } = await supabase.from("rooms" as any).select("id,room_number");
      const m = new Map<string, string>();
      (data ?? []).forEach((r: any) => m.set(r.id, r.room_number));
      return m;
    },
    staleTime: 5 * 60_000,
  });

  const decorate = <T extends { room_id: string | null }>(rows: T[] | undefined) =>
    (rows ?? []).map((r) => ({ ...r, room_number: r.room_id ? rooms.data?.get(r.room_id) ?? null : null }));

  const arrivalsRows = useMemo(() => decorate(arrivals.data), [arrivals.data, rooms.data]);
  const inhouseRows  = useMemo(() => decorate(inhouse.data), [inhouse.data, rooms.data]);

  /* ------------------------------------------------------------------ */
  /* Pending counts per step                                            */
  /* ------------------------------------------------------------------ */
  const counts: Record<string, number> = {
    arrivals:   arrivalsRows.length,
    inhouse:    inhouseRows.length,
    departures: 0,
    dues:       0,
    reconcile:  0,
    review:     0,
    eod:        0,
  };

  const totalPending = counts.arrivals;
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
            {totalPending > 0 && (
              <span className="ml-2 text-amber-500">
                ({totalPending} action{totalPending === 1 ? "" : "s"} required)
              </span>
            )}
          </div>
          <div className="text-[11px] text-muted-foreground">{progressPct}%</div>
        </div>
        <div className="h-1.5 rounded-full bg-secondary/60 overflow-hidden mb-3">
          <div
            className="h-full gold-gradient transition-all"
            style={{ width: `${progressPct}%` }}
          />
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
                  <div className="text-[10px] text-muted-foreground">
                    {isClear ? "Clear" : `${pending} pending`}
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
        />
      )}
      {active === "inhouse" && (
        <InHouseStep
          businessDate={businessDate}
          rows={inhouseRows}
          loading={inhouse.isLoading}
        />
      )}
      {active === "departures" && <Placeholder title="Departures" hint="Pending check-outs, late check-outs, room handover." />}
      {active === "dues" && <Placeholder title="Dues" hint="Outstanding balances across in-house & departing guests." />}
      {active === "reconcile" && <Placeholder title="Reconciliation" hint="Cash counter close, payment mode reconciliation, variance." />}
      {active === "review" && <Placeholder title="Review" hint="Final pre-close review of unresolved items & overrides." />}
      {active === "eod" && <Placeholder title="EOD Report" hint="Printable End-of-Day report. Generated once session is closed." />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Step 1 — Arrivals                                                   */
/* ------------------------------------------------------------------ */

function ArrivalsStep({
  businessDate, rows, loading, refetch,
}: {
  businessDate: string;
  rows: (ArrivalRow & { room_number?: string | null })[];
  loading: boolean;
  refetch: () => void;
}) {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<ArrivalFilter>("all");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<{ id: string; name: string } | null>(null);

  const checkIn = useCheckInController({
    note: "From Night Audit · Arrivals",
    onCheckedIn: () => {
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

  // Filter chips
  const filtered = useMemo(() => {
    return rows.filter((b) => {
      switch (filter) {
        case "ota":           return isOTA(b.lead_source);
        case "walkin":        return b.lead_source === "Walk-in" || b.lead_source === "Walk In";
        case "missing_room":  return !b.room_id;
        case "advance_due":   return (b.amount - (b.advance_paid ?? 0)) > 0;
        default:              return true;
      }
    });
  }, [rows, filter]);

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
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
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
        <div className="text-xs text-emerald-500 italic py-6 text-center">
          ✓ No arrivals match this filter.
        </div>
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
                  <div className="text-sm font-medium truncate flex items-center gap-2">
                    <Link to="/bookings/$id" params={{ id: b.id }} className="hover:text-gold">
                      {b.guest_name}
                    </Link>
                    <span className="text-[11px] text-muted-foreground">· {b.booking_reference}</span>
                    {ota && <Badge variant="outline" className="border-blue-500/40 text-blue-500 text-[10px] h-4">OTA</Badge>}
                    {walkin && <Badge variant="outline" className="border-emerald-500/40 text-emerald-500 text-[10px] h-4">Walk-in</Badge>}
                    {!b.room_id && <Badge variant="outline" className="border-amber-500/40 text-amber-500 text-[10px] h-4">No Room</Badge>}
                    {advanceDue > 0 && (
                      <Badge variant="outline" className="border-destructive/40 text-destructive text-[10px] h-4">
                        Adv Due ₹{advanceDue.toLocaleString("en-IN")}
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
                <div className="flex items-center gap-1.5">
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
                        if (!window.confirm(`Mark "${b.guest_name}" as No-Show? Balance Due becomes ₹0 and any room is freed.`)) return;
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

      {/* Shared check-in flow (OTA phone → docs → rooms → commit) */}
      {checkIn.dialogs}

      <AlertDialog open={!!cancelTarget} onOpenChange={(o) => { if (!o) setCancelTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this booking?</AlertDialogTitle>
            <AlertDialogDescription>
              {cancelTarget?.name && <><span className="font-medium text-foreground">{cancelTarget.name}</span> — </>}
              Marks the booking <span className="font-medium text-foreground">Cancelled</span>,
              frees any assigned room and sets Balance Due to ₹0.
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
  rows: (InHouseRow & { room_number?: string | null })[];
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
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
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
        <div className="text-xs text-emerald-500 italic py-6 text-center">
          ✓ No in-house guests match this filter.
        </div>
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
                      {b.room_number ? (
                        <span className="font-medium">{b.room_number}</span>
                      ) : (
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
                      ) : (
                        <span className="text-emerald-500">Settled</span>
                      )}
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
/* Placeholder steps                                                   */
/* ------------------------------------------------------------------ */

function Placeholder({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-card/30 p-8 text-center">
      <div className="mx-auto h-10 w-10 rounded-full bg-secondary/40 flex items-center justify-center mb-2">
        <Sparkles className="h-5 w-5 text-muted-foreground" />
      </div>
      <h3 className="text-sm font-medium">{title}</h3>
      <p className="text-[11px] text-muted-foreground mt-1">{hint}</p>
      <p className="text-[10px] text-muted-foreground/70 mt-3">Coming in the next Night Audit phase.</p>
    </div>
  );
}
