import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { useState, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Topbar } from "@/components/topbar";
import { listBookings } from "@/lib/bookings-api";
import { listAllChargeTotals } from "@/lib/booking-charges-api";
import { listCustomers } from "@/lib/customers-api";
import { useRealtimeInvalidate } from "@/hooks/use-realtime";
import { useUserRole } from "@/hooks/use-role";
import { BOOKING_STATUSES, bookingStatusStyles } from "@/lib/mock-data";
import { downloadCSV } from "@/lib/csv";
import {
  Search, Loader2, Plus, ChevronRight, BedDouble, Phone, MessageCircle, Download,
  Hotel, Sunrise, CalendarRange, History as HistoryIcon, Repeat, LayoutGrid,
} from "lucide-react";
import { cn, toLocalYMD, smartArrival } from "@/lib/utils";
import { toast } from "sonner";
import { phoneToWaDigits } from "@/lib/phone";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/_authenticated/bookings")({
  component: GatedBookingsPage,
});

/**
 * Route gate: only Owner / Admin can view the bookings list. Reception &
 * Staff are redirected to House View when they hit /bookings directly. The
 * sidebar already hides the link for them — this catches deep-link / typed
 * URL access. RLS on bookings is the real backend guard.
 */
function GatedBookingsPage() {
  const { canManage, isLoading: roleLoading } = useUserRole();
  if (roleLoading) {
    return <div className="p-20 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-gold" /></div>;
  }
  if (!canManage) return <Navigate to="/house-view" />;
  return <BookingsPage />;
}

const STATUS_FILTERS = ["All", "Pending", "Advance Paid", "Full Paid", "Checked-In", "Checked-Out", "Cancelled", "No-Show"] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

function BookingsPage() {
  useRealtimeInvalidate(["bookings", "customers", "booking_charges"], ["bookings", "customers", "all-charge-totals"], "bookings-list");
  const { canManage } = useUserRole();
  const { data: bookings = [], isLoading } = useQuery({ queryKey: ["bookings"], queryFn: listBookings });
  const { data: customers = [] } = useQuery({ queryKey: ["customers"], queryFn: listCustomers });
  const { data: chargeTotals = {} } = useQuery({ queryKey: ["all-charge-totals"], queryFn: listAllChargeTotals });
  const customerById = useMemo(() => Object.fromEntries(customers.map((c) => [c.id, c])), [customers]);

  const [q, setQ] = useState("");
  const [status, setStatus] = useState<StatusFilter>("All");
  const [exportOpen, setExportOpen] = useState(false);

  // Section refs for chip-driven scrolling
  const inHouseRef = useRef<HTMLDivElement>(null);
  const todayRef = useRef<HTMLDivElement>(null);
  const upcomingRef = useRef<HTMLDivElement>(null);
  const pastRef = useRef<HTMLDivElement>(null);

  // Completed-stay counts per customer (for Returning Guest badge).
  // Only counts Checked-Out bookings — cancelled & future ignored.
  const completedByCustomer = useMemo(() => {
    const m: Record<string, number> = {};
    for (const b of bookings) {
      if (b.status === "Checked-Out" && b.customer_id) {
        m[b.customer_id] = (m[b.customer_id] ?? 0) + 1;
      }
    }
    return m;
  }, [bookings]);

  const todayStr = toLocalYMD();

  const matchesSearch = (b: any) => {
    if (!q) return true;
    const ql = q.toLowerCase();
    return (
      b.guest_name.toLowerCase().includes(ql) ||
      b.booking_reference.toLowerCase().includes(ql) ||
      (b.phone ?? "").includes(q)
    );
  };
  const matchesStatus = (b: any) => status === "All" || b.status === status;

  const visible = useMemo(
    () => bookings.filter((b) => matchesSearch(b) && matchesStatus(b)),
    [bookings, q, status],
  );

  // Bucket each visible booking into one of: inHouse, today, upcoming, past
  const sections = useMemo(() => {
    const inHouse: any[] = [];
    const today: any[] = [];
    const upcoming: any[] = [];
    const past: any[] = [];
    for (const b of visible) {
      const isCancelled = b.status === "Cancelled" || b.status === "No-Show";
      const isCheckedIn = b.status === "Checked-In";
      const isPostStay = b.status === "Checked-Out" || b.status === "Stay Completed";
      if (isCheckedIn) { inHouse.push(b); continue; }
      if (isCancelled || isPostStay) { past.push(b); continue; }
      if (b.check_in === todayStr) { today.push(b); continue; }
      if (b.check_in > todayStr) { upcoming.push(b); continue; }
      past.push(b); // missed / overdue → past
    }
    // ordering inside each
    inHouse.sort((a, b) => (a.check_out < b.check_out ? -1 : 1));
    today.sort((a, b) => (a.booking_reference < b.booking_reference ? -1 : 1));
    upcoming.sort((a, b) => (a.check_in < b.check_in ? -1 : 1));
    past.sort((a, b) => (a.check_in < b.check_in ? 1 : -1));
    return { inHouse, today, upcoming, past };
  }, [visible, todayStr]);

  const scrollTo = (ref: React.RefObject<HTMLDivElement | null>) => {
    ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <>
      <Topbar title="Bookings" subtitle="Confirmed stays & reservations" />
      <div className="px-4 md:px-8 py-6 md:py-8 space-y-5 max-w-[1400px]">
        {/* Top action row */}
        <div className="flex flex-col md:flex-row gap-2">
          <div className="flex items-center gap-2 flex-1 px-3 py-2.5 rounded-md bg-card border border-border">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input
              placeholder="Search by name, phone, or booking ref"
              value={q} onChange={(e) => setQ(e.target.value)}
              className="bg-transparent text-sm outline-none flex-1 placeholder:text-muted-foreground/60"
            />
          </div>
          <Link to="/house-view"
            className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-4 py-2 text-sm hover:border-gold/40">
            <LayoutGrid className="h-4 w-4 text-gold" /> House View
          </Link>
          <button onClick={() => setExportOpen(true)} className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-4 py-2 text-sm hover:border-gold/40">
            <Download className="h-4 w-4 text-gold" /> Export
          </button>
          <Link to="/bookings/new" search={{ customerId: undefined, fromQuoteId: undefined } as any}
            className="inline-flex items-center gap-2 rounded-md gold-gradient px-4 py-2 text-sm font-medium text-charcoal hover:shadow-[0_0_18px_oklch(0.82_0.13_82/0.35)]">
            <Plus className="h-4 w-4" /> New Booking
          </Link>
        </div>

        {/* Summary chips — single row on mobile, compact */}
        <div className={cn("grid gap-1.5 md:gap-2", canManage ? "grid-cols-4" : "grid-cols-3")}>
          <Chip icon={Hotel} label="In-House" count={sections.inHouse.length} tone="success" onClick={() => scrollTo(inHouseRef)} />
          <Chip icon={Sunrise} label="Arriving" count={sections.today.length} tone="gold" onClick={() => scrollTo(todayRef)} />
          <Chip icon={CalendarRange} label="Future" count={sections.upcoming.length} tone="info" onClick={() => scrollTo(upcomingRef)} />
          {canManage && (
            <Chip icon={HistoryIcon} label="Past" count={sections.past.length} tone="muted" onClick={() => scrollTo(pastRef)} />
          )}
        </div>

        {/* Status filter row */}
        <div className="flex flex-wrap items-center gap-1.5">
          {STATUS_FILTERS.map((s) => (
            <button key={s} onClick={() => setStatus(s)}
              className={cn(
                "px-3 py-1.5 rounded-full text-[11px] border transition",
                status === s
                  ? "border-gold bg-gold-soft/40 text-foreground"
                  : "border-border bg-card text-muted-foreground hover:border-gold/40 hover:text-foreground",
              )}>
              {s}
            </button>
          ))}
        </div>

        {isLoading ? (
          <div className="p-12 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-gold" /></div>
        ) : (
          <div className="space-y-6">
            <Section refEl={inHouseRef} title="In-House Guests" icon={Hotel} bookings={sections.inHouse} chargeTotals={chargeTotals} completedByCustomer={completedByCustomer} />
            <Section refEl={todayRef} title="Today's Arrivals" icon={Sunrise} bookings={sections.today} chargeTotals={chargeTotals} completedByCustomer={completedByCustomer} />
            <Section refEl={upcomingRef} title="Upcoming Arrivals" icon={CalendarRange} bookings={sections.upcoming} chargeTotals={chargeTotals} completedByCustomer={completedByCustomer} />
            <Section refEl={pastRef} title="Past Bookings" icon={HistoryIcon} bookings={sections.past} chargeTotals={chargeTotals} completedByCustomer={completedByCustomer} />
            {visible.length === 0 && (
              <div className="luxe-card rounded-xl py-16 text-center text-sm text-muted-foreground">
                <BedDouble className="h-8 w-8 text-gold/60 mx-auto mb-3" />
                No bookings match the current filters.
              </div>
            )}
          </div>
        )}
      </div>
      <ExportBookingsDialog open={exportOpen} onOpenChange={setExportOpen} bookings={bookings} customers={customerById as any} />
    </>
  );
}

function Chip({ icon: Icon, label, count, tone, onClick }: {
  icon: any; label: string; count: number; tone: "success" | "gold" | "info" | "muted"; onClick: () => void;
}) {
  const toneCls =
    tone === "success" ? "text-success border-success/30 bg-success/10" :
    tone === "gold" ? "text-gold border-gold/30 bg-gold-soft/30" :
    tone === "info" ? "text-info border-info/30 bg-info/10" :
    "text-muted-foreground border-border bg-card";
  return (
    <button onClick={onClick}
      className={cn("flex items-center justify-center gap-1 px-1.5 py-1.5 md:px-3 md:py-2 rounded-md border whitespace-nowrap transition hover:scale-[1.01]", toneCls)}>
      <Icon className="h-3 w-3 md:h-3.5 md:w-3.5 shrink-0 hidden xs:inline" />
      <span className="text-[10px] md:text-[11px] uppercase tracking-tight md:tracking-wider font-medium">
        {label} <span className="tabular-nums font-display font-semibold ml-0.5">({count})</span>
      </span>
    </button>
  );
}

function Section({ refEl, title, icon: Icon, bookings, chargeTotals, completedByCustomer }: {
  refEl: React.RefObject<HTMLDivElement | null>;
  title: string;
  icon: any;
  bookings: any[];
  chargeTotals: Record<string, number>;
  completedByCustomer: Record<string, number>;
}) {
  return (
    <div ref={refEl} className="luxe-card rounded-xl overflow-hidden scroll-mt-24">
      <div className="px-4 md:px-6 py-3 border-b border-border flex items-center justify-between bg-secondary/30">
        <h3 className="font-display text-base flex items-center gap-2"><Icon className="h-4 w-4 text-gold" /> {title}</h3>
        <span className="text-[11px] text-muted-foreground">{bookings.length} booking{bookings.length === 1 ? "" : "s"}</span>
      </div>
      {bookings.length === 0 ? (
        <div className="py-8 text-center text-xs text-muted-foreground">No bookings in this section.</div>
      ) : (
        bookings.map((b, i) => {
          const isCancelled = b.status === "Cancelled";
          const payable = Number(b.amount) + Number(chargeTotals[b.id] || 0);
          const diff = isCancelled ? 0 : payable - Number(b.advance_paid || 0);
          const balance = Math.max(0, diff);
          const excess = diff < 0 ? -diff : 0;
          const roomType = (b.room_details || "").split("×")[0]?.trim() || null;
          const guestCount = `${b.adults}A${b.children ? ` + ${b.children}C` : ""}`;
          // Prior completed stays = total completed for this customer minus self (if this booking is itself checked-out).
          const completed = b.customer_id ? (completedByCustomer[b.customer_id] ?? 0) : 0;
          const priorCompleted = b.status === "Checked-Out" ? Math.max(0, completed - 1) : completed;
          const isReturning = priorCompleted >= 1
            && !["Checked-In", "Checked-Out", "Stay Completed", "Cancelled"].includes(b.status as string);
          const showArrival = ["Pending", "Confirmed", "Advance Paid", "Full Paid"].includes(b.status);
          const arr = showArrival ? smartArrival((b as any).expected_arrival_at) : null;
          return (
            <motion.div key={b.id} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.02 }}
              className="px-4 md:px-6 py-4 border-b border-border/60 last:border-0 hover:bg-secondary/40 transition">
              <Link to="/bookings/$id" params={{ id: b.id }} className="block">
                <div className="grid grid-cols-3 gap-3 items-start">
                  {/* Col 1: Guest Name + Status + Returning */}
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{b.guest_name}</div>
                    {isReturning && (
                      <div className="mt-0.5 inline-flex items-center gap-1 text-[10px] text-gold/90 font-medium">
                        <Repeat className="h-2.5 w-2.5" /> Returning Guest ({priorCompleted} stay{priorCompleted === 1 ? "" : "s"} past)
                      </div>
                    )}
                    <div className="mt-1">
                      <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[11px]", bookingStatusStyles[b.status as keyof typeof bookingStatusStyles])}>{b.status}</span>
                    </div>
                    {(b as any).special_requests && (
                      <div className="mt-1.5 text-[10px] text-gold/90 leading-snug line-clamp-2" title={(b as any).special_requests}>
                        ✦ {(b as any).special_requests}
                      </div>
                    )}
                  </div>

                  {/* Col 2: Dates + Guests + Room Type */}
                  <div className="text-[11px] text-muted-foreground min-w-0">
                    <div className="whitespace-nowrap">
                      {new Date(b.check_in).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })} – {new Date(b.check_out).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
                    </div>
                    <div className="mt-0.5">{b.nights}N · {guestCount}</div>
                    {roomType && <div className="text-gold/80 font-medium mt-0.5 truncate">{roomType}</div>}
                  </div>

                  {/* Col 3: Arrival + Due Amount + Actions */}
                  <div className="flex flex-col items-end gap-1.5">
                    {arr && (
                      <span className={cn(
                        "text-[10px] font-medium whitespace-nowrap",
                        arr.tone === "gold" && "text-gold/90",
                        arr.tone === "warning" && "text-warning",
                        arr.tone === "muted" && "text-muted-foreground",
                      )}>{arr.label}</span>
                    )}
                    {balance > 0 ? (
                      <span className="text-warning font-medium text-xs whitespace-nowrap">Due ₹{balance.toLocaleString("en-IN")}</span>
                    ) : excess > 0 ? (
                      <span className="text-success font-medium text-xs whitespace-nowrap">Excess Paid ₹{excess.toLocaleString("en-IN")}</span>
                    ) : (
                      <span className="text-success font-medium text-xs">Paid</span>
                    )}
                    <div className="flex items-center gap-0.5">
                      {b.phone && (
                        <>
                          <a href={`tel:${b.phone.replace(/\s+/g, "")}`} onClick={(e) => e.stopPropagation()}
                            className="p-1.5 rounded text-muted-foreground hover:text-gold hover:bg-gold-soft transition" title="Call">
                            <Phone className="h-3.5 w-3.5" />
                          </a>
                          <a href={`https://wa.me/${phoneToWaDigits(b.phone)}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
                            className="p-1.5 rounded text-muted-foreground hover:text-success hover:bg-success/10 transition" title="WhatsApp">
                            <MessageCircle className="h-3.5 w-3.5" />
                          </a>
                        </>
                      )}
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </div>
                </div>
              </Link>
            </motion.div>
          );
        })
      )}
    </div>
  );
}

function ExportBookingsDialog({ open, onOpenChange, bookings, customers }: {
  open: boolean; onOpenChange: (b: boolean) => void; bookings: any[]; customers: Record<string, any>;
}) {
  const [status, setStatus] = useState<string>("All");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const filtered = bookings.filter((b: any) => {
    if (status !== "All" && b.status !== status) return false;
    if (from && b.check_in < from) return false;
    if (to && b.check_in > to) return false;
    return true;
  });

  const onExport = () => {
    try {
      downloadCSV(`bookings-${toLocalYMD()}.csv`,
        filtered.map((b: any) => ({
          Reference: b.booking_reference,
          Guest: b.guest_name,
          Phone: b.phone ?? "",
          Email: b.email ?? "",
          Customer: customers[b.customer_id]?.guest_name ?? "",
          "Customer Ref": customers[b.customer_id]?.customer_reference ?? "",
          "Check-in": b.check_in,
          "Check-out": b.check_out,
          Nights: b.nights,
          Adults: b.adults,
          Children: b.children,
          Rooms: b.room_details ?? "",
          Amount: Number(b.amount),
          "Advance Paid": Number(b.advance_paid || 0),
          Balance: Math.max(0, Number(b.amount) - Number(b.advance_paid || 0)),
          Status: b.status,
          Created: toLocalYMD(new Date(b.created_at)),
        })));
      toast.success(`Exported ${filtered.length} booking${filtered.length === 1 ? "" : "s"}`);
      onOpenChange(false);
    } catch (e: any) { toast.error(e?.message ?? "Export failed"); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Export Bookings</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <label className="block">
            <span className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Status</span>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="w-full bg-input/60 border border-border rounded-md px-3 py-2 text-sm">
              <option value="All">All statuses</option>
              {BOOKING_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Check-In From</span>
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-full bg-input/60 border border-border rounded-md px-3 py-2 text-sm" />
            </label>
            <label className="block">
              <span className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Check-In To</span>
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-full bg-input/60 border border-border rounded-md px-3 py-2 text-sm" />
            </label>
          </div>
          <div className="text-xs text-muted-foreground">{filtered.length} booking{filtered.length === 1 ? "" : "s"} match</div>
        </div>
        <DialogFooter>
          <button onClick={() => onOpenChange(false)} className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground">Cancel</button>
          <button onClick={onExport} className="inline-flex items-center gap-2 rounded-md gold-gradient px-4 py-2 text-sm font-medium text-charcoal">
            <Download className="h-4 w-4" /> Export CSV
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
