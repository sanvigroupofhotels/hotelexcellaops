import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Topbar } from "@/components/topbar";
import { supabase } from "@/integrations/supabase/client";
import { listBookings } from "@/lib/bookings-api";
import { useUserRole } from "@/hooks/use-role";
import { downloadCSV } from "@/lib/csv";
import { PAYMENT_MODES } from "@/lib/booking-payments-api";
import { Loader2, Download, Search, IndianRupee, Wallet, CreditCard, Globe, Banknote } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/payments-reports")({
  component: PaymentsReportsPage,
});

async function listAllBookingPayments() {
  const { data, error } = await supabase
    .from("booking_payments" as any)
    .select("*")
    .order("occurred_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as any[];
}

function PaymentsReportsPage() {
  const { isAdmin, isLoading: roleLoading } = useUserRole();

  const today = new Date().toISOString().slice(0, 10);
  const monthStart = new Date(); monthStart.setDate(1);
  const [from, setFrom] = useState(monthStart.toISOString().slice(0, 10));
  const [to, setTo] = useState(today);
  const [guest, setGuest] = useState("");
  const [bookingRef, setBookingRef] = useState("");
  const [mode, setMode] = useState("All");
  const [collectedBy, setCollectedBy] = useState("");

  const { data: payments = [], isLoading: lp } = useQuery({
    queryKey: ["all-booking-payments"],
    queryFn: listAllBookingPayments,
    enabled: isAdmin,
  });
  const { data: bookings = [], isLoading: lb } = useQuery({
    queryKey: ["bookings"],
    queryFn: listBookings,
    enabled: isAdmin,
  });
  const bookingById = useMemo(() => Object.fromEntries(bookings.map((b: any) => [b.id, b])), [bookings]);

  if (roleLoading) return <div className="p-12 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-gold" /></div>;
  if (!isAdmin) {
    return (
      <>
        <Topbar title="Payments Reports" />
        <div className="px-4 md:px-8 py-12 text-center">
          <p className="text-sm text-muted-foreground">Admins only.</p>
          <Link to="/" className="text-gold text-sm hover:underline">Back to Dashboard</Link>
        </div>
      </>
    );
  }

  const isLoading = lp || lb;

  const enriched = useMemo(() => payments.map((p: any) => {
    const b = bookingById[p.booking_id];
    return {
      ...p,
      _guestName: b?.guest_name ?? "—",
      _bookingRef: b?.booking_reference ?? "—",
      _amount: Number(b?.amount || 0),
      _advance: Number(b?.advance_paid || 0),
      _balance: Math.max(0, Number(b?.amount || 0) - Number(b?.advance_paid || 0)),
    };
  }), [payments, bookingById]);

  const filtered = useMemo(() => enriched.filter((p) => {
    const day = p.occurred_at.slice(0, 10);
    if (from && day < from) return false;
    if (to && day > to) return false;
    if (guest.trim() && !p._guestName.toLowerCase().includes(guest.trim().toLowerCase())) return false;
    if (bookingRef.trim() && !p._bookingRef.toLowerCase().includes(bookingRef.trim().toLowerCase())) return false;
    if (mode !== "All" && p.payment_mode !== mode) return false;
    if (collectedBy.trim() && !(p.collected_by ?? "").toLowerCase().includes(collectedBy.trim().toLowerCase())) return false;
    return true;
  }), [enriched, from, to, guest, bookingRef, mode, collectedBy]);

  const totals = useMemo(() => {
    const byMode: Record<string, number> = {};
    let total = 0;
    for (const p of filtered) {
      total += Number(p.amount || 0);
      byMode[p.payment_mode] = (byMode[p.payment_mode] || 0) + Number(p.amount || 0);
    }
    // Outstanding across ACTIVE bookings (not cancelled, not checked-out)
    const outstanding = bookings
      .filter((b: any) => b.status !== "Cancelled" && b.status !== "Checked-Out")
      .reduce((s: number, b: any) => s + Math.max(0, Number(b.amount) - Number(b.advance_paid || 0)), 0);
    return { total, byMode, outstanding };
  }, [filtered, bookings]);

  const onExport = () => {
    try {
      downloadCSV(`payments-${from}_to_${to}.csv`,
        filtered.map((p) => ({
          "Payment Date": new Date(p.occurred_at).toISOString(),
          "Booking ID": p._bookingRef,
          Guest: p._guestName,
          Amount: Number(p.amount),
          "Payment Mode": p.payment_mode,
          "Collected By": p.collected_by,
          Notes: p.notes ?? "",
          "Booking Total": p._amount,
          "Total Paid": p._advance,
          "Remaining Balance": p._balance,
        })));
      toast.success(`Exported ${filtered.length} payment${filtered.length === 1 ? "" : "s"}`);
    } catch (e: any) { toast.error(e?.message ?? "Export failed"); }
  };

  return (
    <>
      <Topbar title="Payments Reports" subtitle="Booking revenue collection" />
      <div className="px-4 md:px-8 py-6 md:py-8 space-y-5 max-w-[1600px]">

        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <SummaryCard label="Total Collected" value={totals.total} icon={IndianRupee} tone="gold" />
          <SummaryCard label="Cash" value={totals.byMode["Cash"] || 0} icon={Wallet} tone="success" />
          <SummaryCard label="UPI" value={totals.byMode["UPI"] || 0} icon={Banknote} tone="gold" />
          <SummaryCard label="Card" value={totals.byMode["Card"] || 0} icon={CreditCard} tone="gold" />
          <SummaryCard label="OTA" value={(totals.byMode["OTA"] || 0) + (totals.byMode["Hotelzify"] || 0)} icon={Globe} tone="gold" />
          <SummaryCard label="Outstanding (Active)" value={totals.outstanding} icon={IndianRupee} tone="warning" />
        </div>

        {/* Filters */}
        <div className="luxe-card rounded-xl p-3 grid grid-cols-2 md:grid-cols-6 gap-2">
          <label className="block">
            <span className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1">From</span>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-full bg-input/60 border border-border rounded-md px-2 py-1.5 text-sm" />
          </label>
          <label className="block">
            <span className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1">To</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-full bg-input/60 border border-border rounded-md px-2 py-1.5 text-sm" />
          </label>
          <label className="block">
            <span className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Guest Name</span>
            <input value={guest} onChange={(e) => setGuest(e.target.value)} placeholder="Search…" className="w-full bg-input/60 border border-border rounded-md px-2 py-1.5 text-sm" />
          </label>
          <label className="block">
            <span className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Booking ID</span>
            <input value={bookingRef} onChange={(e) => setBookingRef(e.target.value)} placeholder="B-…" className="w-full bg-input/60 border border-border rounded-md px-2 py-1.5 text-sm" />
          </label>
          <label className="block">
            <span className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Payment Mode</span>
            <select value={mode} onChange={(e) => setMode(e.target.value)} className="w-full bg-input/60 border border-border rounded-md px-2 py-1.5 text-sm">
              <option value="All">All</option>
              {PAYMENT_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Collected By</span>
            <input value={collectedBy} onChange={(e) => setCollectedBy(e.target.value)} placeholder="Staff name" className="w-full bg-input/60 border border-border rounded-md px-2 py-1.5 text-sm" />
          </label>
        </div>

        <div className="flex justify-between items-center">
          <div className="text-xs text-muted-foreground inline-flex items-center gap-1.5"><Search className="h-3 w-3" /> {filtered.length} payment{filtered.length === 1 ? "" : "s"}</div>
          <button onClick={onExport} className="inline-flex items-center gap-2 rounded-md gold-gradient px-4 py-2 text-sm font-medium text-charcoal">
            <Download className="h-4 w-4" /> Export Excel (CSV)
          </button>
        </div>

        {/* Table */}
        <div className="luxe-card rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-secondary/30 text-[11px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="text-left px-4 py-2.5">Date</th>
                  <th className="text-left px-4 py-2.5">Booking</th>
                  <th className="text-left px-4 py-2.5">Guest</th>
                  <th className="text-right px-4 py-2.5">Amount</th>
                  <th className="text-left px-4 py-2.5">Mode</th>
                  <th className="text-left px-4 py-2.5">Collected By</th>
                  <th className="text-left px-4 py-2.5">Notes</th>
                  <th className="text-right px-4 py-2.5">Balance</th>
                </tr>
              </thead>
              <tbody>
                {isLoading && (
                  <tr><td colSpan={8} className="p-12 text-center"><Loader2 className="h-5 w-5 animate-spin text-gold mx-auto" /></td></tr>
                )}
                {!isLoading && filtered.length === 0 && (
                  <tr><td colSpan={8} className="p-12 text-center text-muted-foreground">No payments match these filters.</td></tr>
                )}
                {filtered.map((p) => (
                  <tr key={p.id} className="border-t border-border/60 hover:bg-secondary/30">
                    <td className="px-4 py-2.5 text-xs">{new Date(p.occurred_at).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" })}</td>
                    <td className="px-4 py-2.5">
                      <Link to="/bookings/$id" params={{ id: p.booking_id }} className="font-mono text-xs text-gold hover:underline">{p._bookingRef}</Link>
                    </td>
                    <td className="px-4 py-2.5">{p._guestName}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-medium">₹{Number(p.amount).toLocaleString("en-IN")}</td>
                    <td className="px-4 py-2.5">
                      <span className="inline-flex items-center rounded-full border border-border bg-secondary/40 px-2 py-0.5 text-[11px]">{p.payment_mode}</span>
                    </td>
                    <td className="px-4 py-2.5 text-xs">{p.collected_by}</td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground max-w-xs truncate">{p.notes}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-xs">
                      {p._balance > 0 ? <span className="text-warning">₹{p._balance.toLocaleString("en-IN")}</span> : <span className="text-success">Paid</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}

function SummaryCard({ label, value, icon: Icon, tone }: {
  label: string; value: number; icon: any; tone: "gold" | "success" | "warning";
}) {
  const toneClass = tone === "warning" ? "text-warning" : tone === "success" ? "text-success" : "text-gold";
  return (
    <div className="luxe-card rounded-xl p-3">
      <div className="flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
        <Icon className={cn("h-4 w-4", toneClass)} />
      </div>
      <div className="font-display text-xl mt-1 tabular-nums">₹{Number(value).toLocaleString("en-IN")}</div>
    </div>
  );
}
