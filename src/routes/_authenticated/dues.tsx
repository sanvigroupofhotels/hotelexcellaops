import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Topbar } from "@/components/topbar";
import { listBookings, type BookingRow } from "@/lib/bookings-api";
import { listAllChargeTotals } from "@/lib/booking-charges-api";
import { listRooms } from "@/lib/rooms-api";
import { getBusinessDate } from "@/lib/night-audit-api";
import { useRealtimeInvalidate } from "@/hooks/use-realtime";
import { toLocalYMD } from "@/lib/utils";
import { useOpsTimeLabels } from "@/lib/check-times";
import { AddBookingPaymentModal } from "@/components/add-booking-payment-modal";
import { MetricCard } from "@/components/money";
import {
  IndianRupee, Phone, MessageCircle, ExternalLink, Plus, Search, Loader2, AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { phoneToWaDigits } from "@/lib/phone";

export const Route = createFileRoute("/_authenticated/dues")({
  validateSearch: (search: Record<string, unknown>) => ({
    filter: typeof search.filter === "string" ? search.filter : undefined,
  }),
  component: DuesPage,
});

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const fmtStay = (s: string) => new Date(s + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

type FilterKey = "today" | "overdue" | "all" | "inhouse";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "today",      label: "Due Today" },
  { key: "overdue",    label: "Overdue" },
  { key: "all",        label: "All Dues" },
  { key: "inhouse",    label: "In-House" },
];

function daysBetween(fromYmd: string, toYmd: string): number {
  const a = new Date(fromYmd + "T00:00:00").getTime();
  const b = new Date(toYmd + "T00:00:00").getTime();
  return Math.round((b - a) / 86_400_000);
}

function overdueLabel(dueDate: string, businessDate: string): string {
  const n = daysBetween(dueDate, businessDate);
  if (n <= 0) return "Due Today";
  if (n === 1) return "Overdue by 1 Day";
  return `Overdue by ${n} Days`;
}

function DuesPage() {
  useRealtimeInvalidate(
    ["bookings", "booking_charges", "booking_payments"],
    ["bookings", "all-charge-totals"],
    "dues-page",
  );
  const checkTimes = useOpsTimeLabels();
  const searchParams = Route.useSearch();
  const initialFilter = FILTERS.some((f) => f.key === searchParams.filter) ? searchParams.filter as FilterKey : "today";
  const [filter, setFilter] = useState<FilterKey>(initialFilter);
  const [search, setSearch] = useState("");
  const [payFor, setPayFor] = useState<BookingRow | null>(null);

  const { data: bookings = [], isLoading: lb } = useQuery({ queryKey: ["bookings"], queryFn: listBookings });
  const { data: chargeTotals = {} } = useQuery({ queryKey: ["all-charge-totals"], queryFn: listAllChargeTotals });
  const { data: rooms = [] } = useQuery({ queryKey: ["rooms-dues"], queryFn: () => listRooms() });
  const { data: businessDate } = useQuery({ queryKey: ["business-date"], queryFn: getBusinessDate, staleTime: 5 * 60_000 });

  const roomById = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rooms) m.set(r.id, r.room_number);
    return m;
  }, [rooms]);

  // Always work off the Business Date — never the calendar date.
  const bd = businessDate ?? toLocalYMD();

  // Enrich with due + Due Date driven by Check-In.
  const enriched = useMemo(() => {
    return bookings
      .filter((b) => b.status !== "Cancelled" && b.status !== "No-Show")
      .map((b) => {
        const charges = Number((chargeTotals as any)[b.id] ?? 0);
        const total = Number(b.amount) + charges;
        const paid = Number(b.advance_paid ?? 0);
        const due = Math.max(0, total - paid);
        // Due Date is the Check-In Date (reception collects all dues at Check-In).
        const dueDate = b.check_in;
        return { b, total, paid, due, charges, dueDate };
      })
      // Only show after the Due Date is reached. Carries forward indefinitely
      // until balance hits zero or booking is cancelled.
      .filter((r) => r.due > 0 && r.dueDate <= bd);
  }, [bookings, chargeTotals, bd]);

  const filtered = useMemo(() => {
    let rows = enriched;
    if (filter === "today")        rows = rows.filter((r) => r.dueDate === bd);
    else if (filter === "overdue") rows = rows.filter((r) => r.dueDate < bd);
    else if (filter === "inhouse") rows = rows.filter((r) => r.b.status === "Checked-In");
    // "all" → all rows past their due date
    const s = search.trim().toLowerCase();
    if (s) {
      rows = rows.filter((r) =>
        [r.b.guest_name, r.b.phone, r.b.booking_reference, roomById.get(r.b.room_id ?? "")]
          .filter(Boolean).some((v) => String(v).toLowerCase().includes(s)),
      );
    }
    // sort: oldest due first (longest overdue), then highest due
    return [...rows].sort((a, b) => {
      if (a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
      return b.due - a.due;
    });
  }, [enriched, filter, search, bd, roomById]);

  const summary = useMemo(() => {
    const totalOutstanding = enriched.reduce((s, r) => s + r.due, 0);
    const dueToday = enriched.filter((r) => r.dueDate === bd).reduce((s, r) => s + r.due, 0);
    const overdue  = enriched.filter((r) => r.dueDate < bd).reduce((s, r) => s + r.due, 0);
    return { totalOutstanding, dueToday, overdue };
  }, [enriched, bd]);


  return (
    <>
      <Topbar title="Due Collection" subtitle="Proactively collect outstanding balances" />
      <div className="px-4 md:px-8 py-6 md:py-8 max-w-[1400px] space-y-6 pb-32 lg:pb-8">

        {/* Summary cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4">
          <SummaryCard label="Total Outstanding" value={summary.totalOutstanding} tone="danger" />
          <SummaryCard label="Due Today" value={summary.dueToday} tone="gold" />
          <SummaryCard label="Overdue" value={summary.overdue} tone="danger" />
        </div>

        {/* Filter chips + search */}
        <div className="flex flex-wrap items-center gap-2">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={cn(
                "rounded-full px-3 py-1.5 text-xs font-medium border transition",
                filter === f.key
                  ? "border-gold bg-gold-soft text-foreground"
                  : "border-border text-muted-foreground hover:bg-secondary/50",
              )}
            >
              {f.label}
            </button>
          ))}
          <div className="ml-auto relative w-full md:w-72">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search guest, phone, room…"
              className="w-full bg-input/60 border border-border rounded-md pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gold/40"
            />
          </div>
        </div>

        {/* List */}
        {lb ? (
          <div className="p-10 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-gold" /></div>
        ) : filtered.length === 0 ? (
          <div className="luxe-card rounded-xl p-10 flex flex-col items-center text-center gap-2 text-muted-foreground">
            <AlertCircle className="h-6 w-6 text-gold" />
            <div className="text-sm">No outstanding dues in this view.</div>
          </div>
        ) : (
          <>
            {/* Mobile cards */}
            <div className="grid grid-cols-1 md:hidden gap-3">
              {filtered.map(({ b, total, paid, due, dueDate }, i) => (
                <motion.div key={b.id}
                  initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.02 * i }}
                  className="luxe-card rounded-xl p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium truncate">{b.guest_name}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {b.booking_reference} · Room {roomById.get(b.room_id ?? "") ?? "—"}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {fmtStay(b.check_in)} <span className="text-[10px]">{checkTimes.checkIn}</span>
                        {" → "}
                        {fmtStay(b.check_out)} <span className="text-[10px]">{checkTimes.checkOut}</span>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Due</div>
                      <div className="font-display text-lg text-destructive tabular-nums">{inr(due)}</div>
                      <div className={cn("text-[10px] mt-0.5", dueDate < bd ? "text-destructive font-medium" : "text-muted-foreground")}>
                        {overdueLabel(dueDate, bd)}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <Pair label="Total" value={inr(total)} />
                    <Pair label="Paid" value={inr(paid)} />
                  </div>
                  <RowActions b={b} onAddPayment={() => setPayFor(b)} />
                </motion.div>
              ))}
            </div>

            {/* Desktop table */}
            <div className="hidden md:block luxe-card rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-secondary/50 text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <Th>Guest</Th>
                    <Th>Room</Th>
                    <Th>Due Date</Th>
                    <Th>Status</Th>
                    <Th className="text-right">Total</Th>
                    <Th className="text-right">Paid</Th>
                    <Th className="text-right">Due</Th>
                    <Th className="text-right">Actions</Th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(({ b, total, paid, due, dueDate }) => (
                    <tr key={b.id} className="border-t border-border/60 hover:bg-secondary/30">
                      <Td>
                        <Link to="/bookings/$id" params={{ id: b.id }} className="hover:underline">
                          <div className="font-medium">{b.guest_name}</div>
                        </Link>
                        <div className="text-[11px] text-muted-foreground">{b.booking_reference}</div>
                      </Td>
                      <Td>{roomById.get(b.room_id ?? "") ?? "—"}</Td>
                      <Td>
                        {fmtStay(dueDate)}
                        <div className={cn("text-[10px]", dueDate < bd ? "text-destructive font-medium" : "text-muted-foreground")}>
                          {overdueLabel(dueDate, bd)}
                        </div>
                      </Td>
                      <Td><span className="text-[11px] text-muted-foreground">{b.status}</span></Td>
                      <Td className="text-right tabular-nums">{inr(total)}</Td>
                      <Td className="text-right tabular-nums">{inr(paid)}</Td>
                      <Td className="text-right tabular-nums font-medium text-destructive">{inr(due)}</Td>
                      <Td className="text-right">
                        <RowActions b={b} onAddPayment={() => setPayFor(b)} compact />
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>

            </div>
          </>
        )}
      </div>

      {payFor && (
        <AddBookingPaymentModal
          bookingId={payFor.id}
          customerId={payFor.customer_id ?? null}
          maxAmount={Math.max(0, (Number(payFor.amount) + Number((chargeTotals as any)[payFor.id] ?? 0)) - Number(payFor.advance_paid ?? 0))}
          onClose={() => setPayFor(null)}
          onSaved={() => setPayFor(null)}
        />
      )}
    </>
  );
}

function SummaryCard({ label, value, tone }: { label: string; value: number; tone: "danger" | "gold" | "info" }) {
  const mapped = tone === "danger" ? "destructive" : tone === "gold" ? "gold" : "default";
  return (
    <MetricCard
      label={label}
      value={value}
      icon={<IndianRupee className="h-4 w-4" />}
      tone={mapped as any}
      currency
    />
  );
}

function RowActions({ b, onAddPayment, compact }: { b: BookingRow; onAddPayment: () => void; compact?: boolean }) {
  const phoneDigits = phoneToWaDigits(b.phone);
  const cls = "inline-flex items-center justify-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs hover:bg-secondary/60 transition";
  return (
    <div className={cn("flex flex-wrap items-center gap-2", compact && "justify-end")}>
      <Link to="/bookings/$id" params={{ id: b.id }} className={cls}>
        <ExternalLink className="h-3.5 w-3.5" /> Open
      </Link>
      <button onClick={onAddPayment} className={cn(cls, "border-gold/40 bg-gold-soft/30 hover:bg-gold-soft/50")}>
        <Plus className="h-3.5 w-3.5" /> Add Payment
      </button>
      {phoneDigits && (
        <>
          <a href={`tel:${phoneDigits}`} className={cls}>
            <Phone className="h-3.5 w-3.5" /> Call
          </a>
          <a href={`https://wa.me/${phoneDigits}`} target="_blank" rel="noreferrer" className={cls}>
            <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
          </a>
        </>
      )}
    </div>
  );
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return <th className={cn("text-left font-medium px-4 py-2.5", className)}>{children}</th>;
}
function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={cn("px-4 py-3 align-top", className)}>{children}</td>;
}
function Pair({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="tabular-nums">{value}</div>
    </div>
  );
}
