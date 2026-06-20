import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Topbar } from "@/components/topbar";
import { supabase } from "@/integrations/supabase/client";
import { listBookings } from "@/lib/bookings-api";
import { usePermissions } from "@/hooks/use-permissions";
import { downloadCSV } from "@/lib/csv";
import { PAYMENT_MODES, deleteBookingPayment, type BookingPaymentRow } from "@/lib/booking-payments-api";
import { AddBookingPaymentModal } from "@/components/add-booking-payment-modal";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Loader2, Download, Search, IndianRupee, Wallet, CreditCard, Globe, Banknote, Pencil, Trash2, Paperclip } from "lucide-react";
import { cn, toLocalYMD } from "@/lib/utils";
import { toast } from "sonner";
import { MetricCard, Money } from "@/components/money";
import { signedAttachmentUrl } from "@/lib/booking-payments-api";

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

export function PaymentsReportsPage() {
  const { has, isLoading: permissionsLoading } = usePermissions();
  const canView = has("reporting.payments.view");
  const canExport = has("reporting.payments.export");
  const qc = useQueryClient();

  const today = toLocalYMD();
  // Default range is wide (last 12 months) so payments dated via OCR / back-dated
  // entries are never silently hidden. Payment History is the source of truth.
  const yearStart = new Date(); yearStart.setMonth(yearStart.getMonth() - 12);
  const [from, setFrom] = useState(toLocalYMD(yearStart));
  const [to, setTo] = useState(today);
  const [guest, setGuest] = useState("");
  const [bookingRef, setBookingRef] = useState("");
  const [mode, setMode] = useState("All");
  const [collectedBy, setCollectedBy] = useState("");
  const [editPayment, setEditPayment] = useState<BookingPaymentRow | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const { data: payments = [], isLoading: lp } = useQuery({
    queryKey: ["all-booking-payments"],
    queryFn: listAllBookingPayments,
    enabled: canView,
  });
  const { data: bookings = [], isLoading: lb } = useQuery({
    queryKey: ["bookings"],
    queryFn: listBookings,
    enabled: canView,
  });
  const bookingById = useMemo(() => Object.fromEntries(bookings.map((b: any) => [b.id, b])), [bookings]);

  if (permissionsLoading) return <div className="p-12 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-gold" /></div>;
  if (!canView) {
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
    let refunds = 0;
    for (const p of filtered) {
      const signed = Number(p.amount || 0) * (p.is_refund ? -1 : 1);
      total += signed;
      byMode[p.payment_mode] = (byMode[p.payment_mode] || 0) + signed;
      if (p.is_refund) refunds += Number(p.amount || 0);
    }
    // Outstanding across ACTIVE bookings (not cancelled, not no-show, not checked-out)
    const outstanding = bookings
      .filter((b: any) => b.status !== "Cancelled" && b.status !== "No-Show" && b.status !== "Checked-Out")
      .reduce((s: number, b: any) => s + Math.max(0, Number(b.amount) - Number(b.advance_paid || 0)), 0);
    return { total, byMode, outstanding, refunds };
  }, [filtered, bookings]);

  const onExport = () => {
    try {
      downloadCSV(`payments-${from}_to_${to}.csv`,
        filtered.map((p) => ({
          "Payment Date": new Date(p.occurred_at).toISOString(),
          "Booking ID": p._bookingRef,
          Guest: p._guestName,
          Amount: Number(p.amount) * (p.is_refund ? -1 : 1),
          "Payment Mode": p.payment_mode,
          "Type": p.is_refund ? "Refund" : "Payment",
          "UTR": p.utr ?? "",
          "Paid To": p.paid_to ?? "",
          "Collected By": p.collected_by,
          Notes: p.notes ?? "",
          "Booking Total": p._amount,
          "Total Paid": p._advance,
          "Remaining Balance": p._balance,
        })));
      toast.success(`Exported ${filtered.length} payment${filtered.length === 1 ? "" : "s"}`);
    } catch (e: any) { toast.error(e?.message ?? "Export failed"); }
  };

  const openAttachment = async (path: string | null | undefined) => {
    const url = await signedAttachmentUrl(path);
    if (url) window.open(url, "_blank");
    else toast.error("Could not open attachment");
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

        <div className="flex flex-wrap justify-between items-center gap-2">
          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
            <span className="text-muted-foreground">Quick:</span>
            {[
              { label: "Today", days: 0 },
              { label: "7d", days: 7 },
              { label: "30d", days: 30 },
              { label: "90d", days: 90 },
              { label: "1y", days: 365 },
            ].map((q) => (
              <button key={q.label} type="button"
                onClick={() => {
                  const d = new Date(); d.setDate(d.getDate() - q.days);
                  setFrom(toLocalYMD(d)); setTo(today);
                }}
                className="rounded-full border border-border bg-card px-2 py-0.5 hover:border-gold/40">
                {q.label}
              </button>
            ))}
            <button type="button" onClick={() => { setFrom(""); setTo(""); }}
              className="rounded-full border border-border bg-card px-2 py-0.5 hover:border-gold/40">
              All time
            </button>
            <span className="text-muted-foreground inline-flex items-center gap-1.5"><Search className="h-3 w-3" /> {filtered.length} payment{filtered.length === 1 ? "" : "s"}</span>
          </div>
          {canExport && (
            <button onClick={onExport} className="inline-flex items-center gap-2 rounded-md gold-gradient px-4 py-2 text-sm font-medium text-charcoal">
              <Download className="h-4 w-4" /> Export Excel (CSV)
            </button>
          )}
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
                  <th className="text-left px-4 py-2.5">UTR</th>
                  <th className="text-left px-4 py-2.5">Paid To</th>
                  <th className="text-left px-4 py-2.5">Collected By</th>
                  <th className="text-left px-4 py-2.5">Notes</th>
                  <th className="text-right px-4 py-2.5">Balance</th>
                  <th className="text-right px-4 py-2.5">Actions</th>
                </tr>
              </thead>
              <tbody>
                {isLoading && (
                  <tr><td colSpan={11} className="p-12 text-center"><Loader2 className="h-5 w-5 animate-spin text-gold mx-auto" /></td></tr>
                )}
                {!isLoading && filtered.length === 0 && (
                  <tr><td colSpan={11} className="p-12 text-center text-muted-foreground">No payments match these filters.</td></tr>
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
                    <td className="px-4 py-2.5 text-xs font-mono text-muted-foreground max-w-[140px] truncate" title={p.utr ?? ""}>{p.utr ?? "—"}</td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground max-w-[140px] truncate" title={p.paid_to ?? ""}>{p.paid_to ?? "—"}</td>
                    <td className="px-4 py-2.5 text-xs">{p.collected_by}</td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground max-w-xs truncate">{p.notes}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-xs">
                      {p._balance > 0 ? <span className="text-warning">₹{p._balance.toLocaleString("en-IN")}</span> : <span className="text-success">Paid</span>}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="inline-flex items-center gap-0.5">
                        {p.ocr_image_path && (
                          <button onClick={() => openAttachment(p.ocr_image_path)}
                            className="p-1 text-muted-foreground hover:text-gold" title="View attachment">
                            <Paperclip className="h-3.5 w-3.5" />
                          </button>
                        )}
                        <button onClick={() => setEditPayment(p as any)}
                          className="p-1 text-muted-foreground hover:text-gold" title="Edit payment">
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button onClick={() => setDeleteId(p.id)}
                          className="p-1 text-muted-foreground hover:text-destructive" title="Delete payment">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {editPayment && (
        <AddBookingPaymentModal
          bookingId={editPayment.booking_id}
          customerId={(editPayment as any).customer_id ?? ""}
          maxAmount={
            // Allow editing up to current booking total
            (() => {
              const bk = bookingById[editPayment.booking_id];
              const tot = Number(bk?.amount || 0);
              const paid = Number(bk?.advance_paid || 0);
              return Math.max(0, tot - paid) + Number(editPayment.amount);
            })()
          }
          payment={editPayment}
          onClose={() => setEditPayment(null)}
          onSaved={() => {
            setEditPayment(null);
            qc.invalidateQueries({ queryKey: ["all-booking-payments"] });
            qc.invalidateQueries({ queryKey: ["bookings"] });
          }}
        />
      )}

      <AlertDialog open={!!deleteId} onOpenChange={(o) => { if (!o) setDeleteId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this payment?</AlertDialogTitle>
            <AlertDialogDescription>
              This will recalculate <span className="text-foreground">Advance Paid</span> and <span className="text-foreground">Balance Due</span> on the booking, update the CashBook (if applicable), and adjust Payment Reports. The change is recorded in the Payment Audit History. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (!deleteId) return;
                try {
                  await deleteBookingPayment(deleteId);
                  toast.success("Payment removed");
                  qc.invalidateQueries({ queryKey: ["all-booking-payments"] });
                  qc.invalidateQueries({ queryKey: ["bookings"] });
                  qc.invalidateQueries({ queryKey: ["cash"] });
                  setDeleteId(null);
                } catch (e: any) { toast.error(e.message ?? "Delete failed"); }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete Payment
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function SummaryCard({ label, value, icon: Icon, tone }: {
  label: string; value: number; icon: any; tone: "gold" | "success" | "warning";
}) {
  return (
    <MetricCard
      label={label}
      value={value}
      icon={<Icon className="h-4 w-4" />}
      tone={tone}
    />
  );
}
