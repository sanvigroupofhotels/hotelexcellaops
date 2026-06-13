import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { Topbar } from "@/components/topbar";
import { listBookings } from "@/lib/bookings-api";
import { listAllChargeTotals } from "@/lib/booking-charges-api";
import { listComplaints } from "@/lib/complaints-api";
import { listCashTx } from "@/lib/cash-api";
import { listRooms } from "@/lib/rooms-api";
import { supabase } from "@/integrations/supabase/client";
import { buildDailyCashReport, computeOpeningBalance } from "@/lib/cash-report";
import { useRealtimeInvalidate } from "@/hooks/use-realtime";
import { toLocalYMD } from "@/lib/utils";
import { ClipboardCopy, FileBarChart, Loader2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/reporting")({
  component: ReportingPage,
});

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const ymdKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;

function ReportingPage() {
  useRealtimeInvalidate(
    ["bookings", "complaints", "cash_transactions", "booking_charges"],
    ["bookings", "complaints", "cash-tx", "all-charge-totals"],
    "reporting",
  );

  const { data: bookings = [], isLoading: lb } = useQuery({ queryKey: ["bookings"], queryFn: listBookings });
  const { data: chargeTotals = {} } = useQuery({ queryKey: ["all-charge-totals"], queryFn: listAllChargeTotals });
  const { data: complaints = [], isLoading: lc } = useQuery({ queryKey: ["complaints"], queryFn: () => listComplaints() });
  const { data: tx = [], isLoading: lt } = useQuery({ queryKey: ["cash-tx"], queryFn: () => listCashTx({ includeInactive: false }) });

  const today = toLocalYMD();
  const todayDate = new Date(); todayDate.setHours(0,0,0,0);
  const todayKey = ymdKey(todayDate);

  const metrics = useMemo(() => {
    const active = bookings.filter((b) => b.status !== "Cancelled");
    const occupied = active.filter((b) => b.status === "Checked-In").length;
    const arrivalsToday = active.filter((b) => b.check_in === today && b.status !== "Checked-Out").length;
    const checkinsDone = active.filter((b) => b.check_in === today && b.status === "Checked-In").length;
    const checkoutsToday = active.filter((b) => b.check_out === today).length;
    const checkoutsDone = active.filter((b) => b.check_out === today && b.status === "Checked-Out").length;
    const pendingCheckins = active.filter((b) => b.check_in <= today && !["Checked-In","Checked-Out"].includes(b.status as string)).length;
    const pendingDues = active
      .filter((b) => b.status !== "Checked-Out")
      .reduce((s, b) => {
        const charges = Number((chargeTotals as any)[b.id] ?? 0);
        return s + Math.max(0, Number(b.amount) + charges - Number(b.advance_paid ?? 0));
      }, 0);
    const openComplaints = complaints.filter((c) => c.status === "Open" || c.status === "In Progress").length;

    // cash today
    let opening = 0, todayIn = 0, todayOut = 0;
    for (const t of tx) {
      if (!t.active) continue;
      const k = ymdKey(new Date(t.occurred_at));
      const amt = Number(t.amount);
      if (k < todayKey) opening += t.kind === "collection" ? amt : -amt;
      else if (k === todayKey) {
        if (t.kind === "collection") todayIn += amt;
        else todayOut += amt;
      }
    }
    const balance = opening + todayIn - todayOut;

    // online vs cash split (today collections)
    const todayCollections = tx.filter((t) => t.active && t.kind === "collection" && ymdKey(new Date(t.occurred_at)) === todayKey);
    const onlineToday = todayCollections
      .filter((t) => /razorpay|online|upi|card/i.test([t.type_name, t.description, t.notes].filter(Boolean).join(" ")))
      .reduce((s, t) => s + Number(t.amount), 0);
    const cashToday = todayIn - onlineToday;

    const occupancyPct = active.length ? Math.round((occupied / Math.max(1, occupied + pendingCheckins)) * 100) : 0;

    return {
      occupied, arrivalsToday, checkinsDone, checkoutsToday, checkoutsDone,
      pendingCheckins, pendingDues, openComplaints,
      opening, todayIn, todayOut, balance, onlineToday, cashToday, occupancyPct,
    };
  }, [bookings, chargeTotals, complaints, tx, today, todayKey]);

  const loading = lb || lc || lt;

  const handover = useMemo(() => [
    `🛎 *Shift Handover — ${todayDate.toLocaleDateString("en-IN", { day:"2-digit", month:"short", year:"numeric" })}*`,
    ``,
    `🏨 Occupied Rooms: ${metrics.occupied}`,
    `🟢 Today's Arrivals: ${metrics.arrivalsToday}`,
    `🚶 Today's Check-outs: ${metrics.checkoutsToday}`,
    `🔴 Pending Check-ins: ${metrics.pendingCheckins}`,
    `💰 Pending Dues: ${inr(metrics.pendingDues)}`,
    `📣 Open Complaints: ${metrics.openComplaints}`,
    `💵 Current Cash Balance: ${inr(metrics.balance)}`,
  ].join("\n"), [metrics, todayDate]);

  const daily = useMemo(() => [
    `📊 *Daily Operations Report — ${todayDate.toLocaleDateString("en-IN", { day:"2-digit", month:"short", year:"numeric" })}*`,
    ``,
    `🏨 Occupancy: ${metrics.occupied} rooms (${metrics.occupancyPct}%)`,
    `🟢 Check-ins Today: ${metrics.checkinsDone}/${metrics.arrivalsToday}`,
    `🚶 Check-outs Today: ${metrics.checkoutsDone}/${metrics.checkoutsToday}`,
    `💰 Revenue Collected Today: ${inr(metrics.todayIn)}`,
    `   • Cash: ${inr(metrics.cashToday)}`,
    `   • Online: ${inr(metrics.onlineToday)}`,
    `💸 Expenses Today: ${inr(metrics.todayOut)}`,
    `📌 Pending Dues: ${inr(metrics.pendingDues)}`,
    `📣 Open Complaints: ${metrics.openComplaints}`,
  ].join("\n"), [metrics, todayDate]);

  const cash = useMemo(() => {
    const today = new Date(); today.setHours(0,0,0,0);
    return buildDailyCashReport(tx, today, computeOpeningBalance(tx, today));
  }, [tx]);

  return (
    <>
      <Topbar title="Reporting" subtitle="Operational reports — copy & share on WhatsApp" />
      <div className="px-4 md:px-8 py-6 md:py-8 space-y-6 max-w-[1100px]">
        {loading ? (
          <div className="p-10 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-gold" /></div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            <ReportCard title="Shift Handover Report" subtitle="Concise operational snapshot" text={handover} />
            <ReportCard title="Daily Operations Report" subtitle="End-of-day operational summary" text={daily} />
            <ReportCard title="Today's Cash Report" subtitle="Cashbook opening / in / out / balance" text={cash} />
          </div>
        )}
      </div>
    </>
  );
}

function ReportCard({ title, subtitle, text }: { title: string; subtitle: string; text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success(`${title} copied to clipboard.`);
      setTimeout(() => setCopied(false), 1500);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not copy");
    }
  };
  return (
    <motion.div initial={{opacity:0,y:6}} animate={{opacity:1,y:0}} className="luxe-card rounded-xl p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <FileBarChart className="h-4 w-4 text-gold" />
            <h3 className="font-display text-base">{title}</h3>
          </div>
          <div className="text-[11px] text-muted-foreground mt-0.5">{subtitle}</div>
        </div>
        <button onClick={copy}
          className="inline-flex items-center gap-1.5 rounded-md border border-gold/40 bg-gold-soft/30 px-3 py-1.5 text-xs hover:bg-gold-soft/50">
          <ClipboardCopy className="h-3.5 w-3.5" /> {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="whitespace-pre-wrap font-sans text-xs leading-relaxed text-foreground/90 bg-secondary/40 rounded-md p-3 border border-border">
        {text}
      </pre>
    </motion.div>
  );
}
