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
  IndianRupee, Phone, MessageCircle, ExternalLink, Plus, Search, Loader2, AlertCircle, Copy,
} from "lucide-react";
import { toast } from "sonner";
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

type FilterKey = "today" | "overdue" | "future" | "all" | "inhouse";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "today",      label: "Due Today" },
  { key: "overdue",    label: "Overdue" },
  { key: "future",     label: "Future Dues" },
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
  if (n === 0) return "Due Today";
  if (n > 0) return n === 1 ? "Overdue by 1 Day" : `Overdue by ${n} Days`;
  const days = -n;
  return days === 1 ? "Due Tomorrow" : `Due in ${days} Days`;
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
  // NOTE: same calculation drives every section (Today / Overdue / Future / In-House / All).
  // Filters only change which dueDate vs business-date subset is shown — never the math.
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
      // Keep every booking with a positive balance — Future Dues need pre-business-date rows too.
      .filter((r) => r.due > 0);
  }, [bookings, chargeTotals]);

  const filtered = useMemo(() => {
    let rows = enriched;
    if (filter === "today")        rows = rows.filter((r) => r.dueDate <= bd);
    else if (filter === "overdue") rows = rows.filter((r) => r.dueDate < bd);
    else if (filter === "future")  rows = rows.filter((r) => r.dueDate > bd);
    else if (filter === "inhouse") rows = rows.filter((r) => r.b.status === "Checked-In");
    // "all" → every row with a balance (past, today, and future)
    const s = search.trim().toLowerCase();
    if (s) {
      rows = rows.filter((r) =>
        [r.b.guest_name, r.b.phone, r.b.booking_reference, roomById.get(r.b.room_id ?? "")]
          .filter(Boolean).some((v) => String(v).toLowerCase().includes(s)),
      );
    }
    // sort: for future bookings show soonest first; otherwise longest overdue first.
    return [...rows].sort((a, b) => {
      if (a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
      return b.due - a.due;
    });
  }, [enriched, filter, search, bd, roomById]);

  const summary = useMemo(() => {
    const dueToday = enriched.filter((r) => r.dueDate <= bd).reduce((s, r) => s + r.due, 0);
    const overdue  = enriched.filter((r) => r.dueDate < bd).reduce((s, r) => s + r.due, 0);
    const future   = enriched.filter((r) => r.dueDate > bd).reduce((s, r) => s + r.due, 0);
    const totalOutstanding = dueToday + future;
    return { totalOutstanding, dueToday, overdue, future };
  }, [enriched, bd]);



  return (
    <>
      <Topbar title="Due Collection" subtitle="Proactively collect outstanding balances" />
      <div className="px-4 md:px-8 py-6 md:py-8 max-w-[1400px] space-y-6 pb-32 lg:pb-8">

        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
          <SummaryCard label="Total Outstanding" value={summary.totalOutstanding} tone="danger" />
          <SummaryCard label="Due Today" value={summary.dueToday} tone="gold" />
          <SummaryCard label="Overdue" value={summary.overdue} tone="danger" />
          <SummaryCard label="Future Dues" value={summary.future} tone="info" />
        </div>


        {/* UAT-026 · Filter chips (left) → Search + Copy Due Summary (right-aligned).
            Force `justify-end` on the trailing cluster so the button visibly
            hugs the right edge even when filter chips wrap. */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap items-center gap-2 flex-1 min-w-0">
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
          </div>
          <div className="flex flex-wrap items-center gap-2 w-full md:w-auto justify-end md:ml-auto">
            <div className="relative w-full md:w-64">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search guest, phone, room…"
                className="w-full bg-input/60 border border-border rounded-md pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gold/40"
              />
            </div>
            <CopyDueSummaryButton
              filterKey={filter}
              rows={filtered.map(({ b, due }) => ({
                guest: b.guest_name,
                room: roomById.get(b.room_id ?? "") ?? "—",
                due,
              }))}
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

/**
 * UAT-026 — copies the currently filtered view as a WhatsApp-ready summary.
 * Header text is derived from the active filter so pasted content is
 * self-describing when it lands in the internal collection group.
 */
function CopyDueSummaryButton({
  filterKey, rows,
}: { filterKey: FilterKey; rows: { guest: string; room: string; due: number }[] }) {
  const totalDue = rows.reduce((s, r) => s + Number(r.due || 0), 0);
  const HEADERS: Record<FilterKey, string> = {
    all:      "Pending Dues (All Guests)",
    inhouse:  "Pending Dues from In-House Guests",
    today:    "Pending Dues from Today's Guests",
    future:   "Pending Dues from Future Guests",
    overdue:  "Pending Dues (Overdue)",
  };
  const heading = HEADERS[filterKey] ?? "Pending Dues";
  const onCopy = async () => {
    if (rows.length === 0) { toast.error("No dues in this view to copy"); return; }
    const lines = [
      `*${heading}* — ${rows.length} guest${rows.length === 1 ? "" : "s"} · Total ₹${Math.round(totalDue).toLocaleString("en-IN")}`,
      "",
      ...rows.map((r, i) =>
        `${i + 1}. ${r.guest} · Room ${r.room} · ₹${Math.round(Number(r.due)).toLocaleString("en-IN")}`,
      ),
    ];
    const text = lines.join("\n");
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed"; ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      toast.success(`Copied ${rows.length} due${rows.length === 1 ? "" : "s"}`);
    } catch {
      toast.error("Could not copy — please copy manually");
    }
  };
  return (
    <button
      onClick={onCopy}
      className="rounded-full px-3 py-1.5 text-xs font-medium border border-gold/40 bg-gold-soft/30 hover:bg-gold-soft/50 inline-flex items-center gap-1.5 whitespace-nowrap"
      title="Copy summary for WhatsApp"
    >
      <Copy className="h-3.5 w-3.5" /> Copy Due Summary
    </button>
  );
}

