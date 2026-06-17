import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Topbar } from "@/components/topbar";
import { listBookings, type BookingRow } from "@/lib/bookings-api";
import { listAllChargeTotals } from "@/lib/booking-charges-api";
import { listRooms } from "@/lib/rooms-api";
import { useRealtimeInvalidate } from "@/hooks/use-realtime";
import { toLocalYMD } from "@/lib/utils";
import { AddBookingPaymentModal } from "@/components/add-booking-payment-modal";
import { MetricCard, Money } from "@/components/money";
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

type FilterKey = "today" | "tomorrow" | "all" | "inhouse" | "checkedout";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "today",      label: "Due Today" },
  { key: "tomorrow",   label: "Due Tomorrow" },
  { key: "all",        label: "All Dues" },
  { key: "inhouse",    label: "In-House" },
  { key: "checkedout", label: "Checked-Out (with due)" },
];

function DuesPage() {
  useRealtimeInvalidate(
    ["bookings", "booking_charges", "booking_payments"],
    ["bookings", "all-charge-totals"],
    "dues-page",
  );
  const searchParams = Route.useSearch();
  const initialFilter = FILTERS.some((f) => f.key === searchParams.filter) ? searchParams.filter as FilterKey : "today";
  const [filter, setFilter] = useState<FilterKey>(initialFilter);
  const [search, setSearch] = useState("");
  const [payFor, setPayFor] = useState<BookingRow | null>(null);

  const { data: bookings = [], isLoading: lb } = useQuery({ queryKey: ["bookings"], queryFn: listBookings });
  const { data: chargeTotals = {} } = useQuery({ queryKey: ["all-charge-totals"], queryFn: listAllChargeTotals });
  const { data: rooms = [] } = useQuery({ queryKey: ["rooms-dues"], queryFn: () => listRooms() });

  const roomById = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rooms) m.set(r.id, r.room_number);
    return m;
  }, [rooms]);

  const today = toLocalYMD();
  const tomorrow = useMemo(() => {
    const d = new Date(); d.setDate(d.getDate() + 1);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  }, []);

  // Enrich with due
  const enriched = useMemo(() => {
    return bookings
      .filter((b) => b.status !== "Cancelled")
      .map((b) => {
        const charges = Number((chargeTotals as any)[b.id] ?? 0);
        const total = Number(b.amount) + charges;
        const paid = Number(b.advance_paid ?? 0);
        const due = b.status === "Cancelled" ? 0 : Math.max(0, total - paid);
        return { b, total, paid, due, charges };
      })
      .filter((r) => r.due > 0);
  }, [bookings, chargeTotals]);

  const filtered = useMemo(() => {
    let rows = enriched;
    if (filter === "today")      rows = rows.filter((r) => r.b.check_out === today && r.b.status !== "Checked-Out");
    else if (filter === "tomorrow") rows = rows.filter((r) => r.b.check_out === tomorrow && r.b.status !== "Checked-Out");
    else if (filter === "inhouse")  rows = rows.filter((r) => r.b.status === "Checked-In");
    else if (filter === "checkedout") rows = rows.filter((r) => r.b.status === "Checked-Out");
    // "all" → no extra filter
    const s = search.trim().toLowerCase();
    if (s) {
      rows = rows.filter((r) =>
        [r.b.guest_name, r.b.phone, r.b.booking_reference, roomById.get(r.b.room_id ?? "")]
          .filter(Boolean).some((v) => String(v).toLowerCase().includes(s)),
      );
    }
    // sort by checkout date asc, then due desc
    return [...rows].sort((a, b) => {
      if (a.b.check_out !== b.b.check_out) return a.b.check_out < b.b.check_out ? -1 : 1;
      return b.due - a.due;
    });
  }, [enriched, filter, search, today, tomorrow, roomById]);

  const summary = useMemo(() => {
    const totalOutstanding = enriched.reduce((s, r) => s + r.due, 0);
    const dueToday = enriched
      .filter((r) => r.b.check_out === today && r.b.status !== "Checked-Out")
      .reduce((s, r) => s + r.due, 0);
    const dueTomorrow = enriched
      .filter((r) => r.b.check_out === tomorrow && r.b.status !== "Checked-Out")
      .reduce((s, r) => s + r.due, 0);
    return { totalOutstanding, dueToday, dueTomorrow };
  }, [enriched, today, tomorrow]);

  return (
    <>
      <Topbar title="Due Collection" subtitle="Proactively collect outstanding balances" />
      <div className="px-4 md:px-8 py-6 md:py-8 max-w-[1400px] space-y-6 pb-32 lg:pb-8">

        {/* Summary cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4">
          <SummaryCard label="Total Outstanding" value={summary.totalOutstanding} tone="danger" />
          <SummaryCard label="Due Today" value={summary.dueToday} tone="gold" />
          <SummaryCard label="Due Tomorrow" value={summary.dueTomorrow} tone="info" />
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
              {filtered.map(({ b, total, paid, due }, i) => (
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
                        {b.check_in} → {b.check_out}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Due</div>
                      <div className="font-display text-lg text-destructive tabular-nums">{inr(due)}</div>
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
                    <Th>Check-In</Th>
                    <Th>Check-Out</Th>
                    <Th className="text-right">Total</Th>
                    <Th className="text-right">Paid</Th>
                    <Th className="text-right">Due</Th>
                    <Th className="text-right">Actions</Th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(({ b, total, paid, due }) => (
                    <tr key={b.id} className="border-t border-border/60 hover:bg-secondary/30">
                      <Td>
                        <Link to="/bookings/$id" params={{ id: b.id }} className="hover:underline">
                          <div className="font-medium">{b.guest_name}</div>
                        </Link>
                        <div className="text-[11px] text-muted-foreground">{b.booking_reference}</div>
                      </Td>
                      <Td>{roomById.get(b.room_id ?? "") ?? "—"}</Td>
                      <Td>{b.check_in}</Td>
                      <Td>{b.check_out}</Td>
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
