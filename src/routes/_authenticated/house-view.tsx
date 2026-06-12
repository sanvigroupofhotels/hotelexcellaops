import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Topbar } from "@/components/topbar";
import { listRooms, listMaintenance } from "@/lib/rooms-api";
import { listBookings } from "@/lib/bookings-api";
import { listBookingItems } from "@/lib/booking-items-api";
import { supabase } from "@/integrations/supabase/client";
import { ChevronLeft, ChevronRight, Loader2, X, Phone, Hotel, UtensilsCrossed, AlertTriangle, FileText, Plus, Ban } from "lucide-react";
import { cn, toLocalYMD, smartArrival } from "@/lib/utils";
import { toast } from "sonner";
import { AddBookingPaymentModal } from "@/components/add-booking-payment-modal";
import { InvoiceDialog } from "@/components/invoice-dialog";
import { listBookingPayments } from "@/lib/booking-payments-api";
import { BlockRoomDialog } from "@/components/block-room-dialog";

export const Route = createFileRoute("/_authenticated/house-view")({
  component: HouseView,
});

const DAY_COUNT = 7;
const CELL_W = 170;
const CELL_W_MOB = 150;
const ROOM_COL_W = 120;

function dateKey(d: Date) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function addDays(d: Date, n: number) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function fmtShort(d: Date) { return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" }); }
function fmtFull(d: string) { return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }); }

/** Pill colors keyed by booking status. */
function blockClasses(status: string): string {
  switch (status) {
    case "Checked-In":
      return "bg-green-500/85 text-white border-green-700";
    case "Checked-Out":
    case "Stay Completed":
      return "bg-gray-400/70 text-white border-gray-600 dark:bg-gray-500/70 dark:border-gray-400";
    case "Advance Paid":
    case "Full Paid":
      return "bg-blue-500/85 text-white border-blue-700";
    case "Cancelled":
      return "bg-destructive/40 text-foreground border-destructive/60 line-through";
    case "Pending":
    case "Confirmed":
    default:
      return "bg-white text-gray-900 border-gray-500 dark:bg-zinc-100 dark:text-zinc-900 dark:border-zinc-400";
  }
}

function datesOverlap(aIn: string, aOut: string, bIn: string, bOut: string) {
  return aIn < bOut && bIn < aOut;
}

function HouseView() {
  const [anchor, setAnchor] = useState(() => { const t = new Date(); t.setHours(0,0,0,0); return t; });
  const [selected, setSelected] = useState<any | null>(null);
  const [selectedBlock, setSelectedBlock] = useState<any | null>(null);
  const [editBlock, setEditBlock] = useState<any | null>(null);
  const [vacantAction, setVacantAction] = useState<{ room: any; date: string } | null>(null);
  const [statsOpen, setStatsOpen] = useState(false);

  const { data: rooms = [], isLoading: lr } = useQuery({ queryKey: ["rooms", "active"], queryFn: () => listRooms(true) });
  const { data: bookings = [], isLoading: lb } = useQuery({ queryKey: ["bookings"], queryFn: listBookings });
  const { data: blocks = [] } = useQuery({
    queryKey: ["room_maintenance", "active"],
    queryFn: async () => (await listMaintenance()).filter((m: any) => m.active !== false),
  });
  // All booking items (for breakfast lookup keyed by booking_id)
  const { data: allItems = [] } = useQuery({
    queryKey: ["booking-items-all"],
    queryFn: async () => {
      const { data, error } = await supabase.from("booking_items" as any).select("booking_id,breakfast_included");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
  const isLoading = lr || lb;

  const days = useMemo(() => Array.from({ length: DAY_COUNT }, (_, i) => addDays(anchor, i)), [anchor]);
  const dayKeys = days.map(dateKey);
  const rangeStart = dayKeys[0];
  const rangeEnd = dateKey(addDays(anchor, DAY_COUNT));

  // Breakfast lookup: bookingId -> hasBreakfast (any item with breakfast=true)
  const breakfastByBooking = useMemo(() => {
    const m = new Map<string, boolean>();
    for (const it of allItems as any[]) {
      if (it.breakfast_included) m.set(it.booking_id, true);
    }
    return m;
  }, [allItems]);

  const visibleBookings = useMemo(
    () => (bookings as any[]).filter((b) => b.status !== "Cancelled" && b.check_in < rangeEnd && b.check_out > rangeStart),
    [bookings, rangeStart, rangeEnd],
  );

  // Blocks (maintenance) visible in range
  const visibleBlocks = useMemo(
    () => (blocks as any[]).filter((m) => m.start_date < rangeEnd && m.end_date > rangeStart),
    [blocks, rangeStart, rangeEnd],
  );

  /** Greedy place unassigned bookings into vacant rooms (display-only). */
  const byRoom = useMemo(() => {
    const m = new Map<string, any[]>();
    const assigned = visibleBookings.filter((b) => b.room_id);
    const unassigned = visibleBookings.filter((b) => !b.room_id);
    for (const b of assigned) {
      const arr = m.get(b.room_id) ?? [];
      arr.push(b); m.set(b.room_id, arr);
    }
    for (const b of unassigned) {
      let placed = false;
      for (const r of rooms) {
        const arr = m.get(r.id) ?? [];
        const conflict = arr.some((x) => datesOverlap(b.check_in, b.check_out, x.check_in, x.check_out));
        if (!conflict) { arr.push({ ...b, _virtual: true }); m.set(r.id, arr); placed = true; break; }
      }
      if (!placed && rooms[0]) {
        const arr = m.get(rooms[0].id) ?? [];
        arr.push({ ...b, _virtual: true }); m.set(rooms[0].id, arr);
      }
    }
    return m;
  }, [visibleBookings, rooms]);

  const blocksByRoom = useMemo(() => {
    const m = new Map<string, any[]>();
    for (const x of visibleBlocks) {
      const arr = m.get(x.room_id) ?? [];
      arr.push(x); m.set(x.room_id, arr);
    }
    return m;
  }, [visibleBlocks]);

  // -------- House Overview stats (for selected date = today) --------
  const todayKey = dateKey(new Date());
  const occupiedRooms = new Set<string>();
  const inHouseBookings: any[] = [];
  let arrivalsToday = 0, departuresToday = 0;
  for (const b of (bookings as any[])) {
    if (b.status === "Cancelled") continue;
    if (b.check_in === todayKey) arrivalsToday++;
    if (b.check_out === todayKey) departuresToday++;
    const inHouse = b.check_in <= todayKey && b.check_out > todayKey
      && b.status !== "Checked-Out" && b.status !== "Stay Completed";
    if (inHouse) {
      inHouseBookings.push(b);
      if (b.room_id) occupiedRooms.add(b.room_id);
    }
  }
  const totalRooms = rooms.length;
  const vacant = totalRooms - occupiedRooms.size;
  const occPct = totalRooms ? Math.round((occupiedRooms.size / totalRooms) * 100) : 0;

  const adultsInHouse = inHouseBookings.reduce((s, b) => s + (Number(b.adults) || 0), 0);
  const childrenInHouse = inHouseBookings.reduce((s, b) => s + (Number(b.children) || 0), 0);

  const breakfastBookings = inHouseBookings.filter((b) => breakfastByBooking.get(b.id));
  const adultsBreakfast = breakfastBookings.reduce((s, b) => s + (Number(b.adults) || 0), 0);
  const childrenBreakfast = breakfastBookings.reduce((s, b) => s + (Number(b.children) || 0), 0);

  const roomNumber = (id: string | null) => {
    if (!id) return null;
    const r = rooms.find((x: any) => x.id === id);
    return r ? r.room_number : null;
  };
  const breakfastRoomNumbers = breakfastBookings.map((b) => roomNumber(b.room_id)).filter(Boolean) as string[];
  const inHouseRoomNumbers = inHouseBookings.map((b) => roomNumber(b.room_id)).filter(Boolean) as string[];

  return (
    <>
      <Topbar title="House View" subtitle="Room occupancy at a glance" />
      <div className="px-4 md:px-8 py-6 md:py-8 max-w-[1600px] space-y-6">

        {/* Navigation + House Overview */}
        <div className="luxe-card rounded-xl p-4 flex items-center justify-between gap-3">
          <button onClick={() => setAnchor((d) => addDays(d, -1))} className="p-2 rounded-md border border-border hover:border-gold/40"><ChevronLeft className="h-4 w-4" /></button>
          <div className="flex items-center gap-2 flex-wrap justify-center">
            <input type="date" value={dateKey(anchor)} onChange={(e) => { const d = new Date(e.target.value); if (!isNaN(d.getTime())) setAnchor(d); }}
              className="bg-input/60 border border-border rounded-md px-3 py-1.5 text-sm" />
            <button onClick={() => { const t = new Date(); t.setHours(0,0,0,0); setAnchor(t); }}
              className="px-3 py-1.5 rounded-md border border-border text-xs hover:border-gold/40">Today</button>
            <button onClick={() => setStatsOpen(true)}
              className="px-3 py-1.5 rounded-md border border-gold/40 bg-gold-soft/30 text-xs hover:bg-gold-soft/50 flex items-center gap-1.5">
              <Hotel className="h-3.5 w-3.5" /> House Overview
            </button>
          </div>
          <button onClick={() => setAnchor((d) => addDays(d, 1))} className="p-2 rounded-md border border-border hover:border-gold/40"><ChevronRight className="h-4 w-4" /></button>
        </div>

        {/* Grid */}
        {isLoading ? (
          <div className="p-12 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-gold" /></div>
        ) : (
          <div className="luxe-card rounded-xl p-0 overflow-x-auto relative">
            <table className="border-separate border-spacing-0 min-w-fit">
              <thead>
                <tr>
                  <th
                    className="sticky left-0 z-20 bg-card border-b-2 border-r-2 border-border px-2 py-2 text-[10px] uppercase tracking-wider text-muted-foreground text-left"
                    style={{ width: ROOM_COL_W, minWidth: ROOM_COL_W }}
                  >Room</th>
                  {days.map((d, i) => {
                    const isToday = dateKey(d) === todayKey;
                    const isLast = i === days.length - 1;
                    return (
                      <th key={d.toISOString()}
                        className={cn("border-b-2 border-r-2 border-border px-2 py-2 text-[10px] uppercase tracking-wider text-center",
                          isToday ? "text-gold bg-gold-soft/40" : "text-muted-foreground",
                          isLast && "border-r-0")}
                        style={{ minWidth: CELL_W_MOB, width: CELL_W }}>
                        <div className="font-medium">{d.toLocaleDateString("en-IN", { weekday: "short" })}</div>
                        <div className="text-foreground text-xs">{fmtShort(d)}</div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {rooms.map((r) => {
                  const bs = byRoom.get(r.id) ?? [];
                  const ms = blocksByRoom.get(r.id) ?? [];
                  return (
                    <tr key={r.id} className="group">
                      <td
                        className="sticky left-0 z-10 bg-card border-b border-r-2 border-border px-2 py-3 text-xs align-top"
                        style={{ width: ROOM_COL_W, minWidth: ROOM_COL_W }}
                      >
                        <div className="font-medium">Room {r.room_number}</div>
                        <div className="text-[10px] text-muted-foreground">{r.room_type} · F{r.floor}</div>
                      </td>
                      {/* Per-day cells with relative wrapper so we can position pills absolutely */}
                      {days.map((d, i) => {
                        const dk = dateKey(d);
                        const isToday = dk === todayKey;
                        // Render pills only in the start cell to span across
                        const startingBookings = bs.filter((b) => {
                          const startKey = b.check_in < rangeStart ? rangeStart : b.check_in;
                          return startKey === dk;
                        });
                        const startingBlocks = ms.filter((m: any) => {
                          const startKey = m.start_date < rangeStart ? rangeStart : m.start_date;
                          return startKey === dk;
                        });
                        return (
                          <td key={i}
                            className={cn(
                              "relative border-b border-r border-border align-top h-14 p-0 group/cell",
                              isToday && "bg-gold-soft/10",
                              i % 2 === 0 && !isToday && "bg-secondary/10",
                              i === days.length - 1 && "border-r-0",
                            )}
                            style={{ minWidth: CELL_W_MOB, width: CELL_W }}>
                            <div className="relative h-full" style={{ minHeight: 56 }}>
                              {/* Vacant action button — visible when no booking/block starts here AND no booking covers this day */}
                              {(() => {
                                const coveredByBooking = bs.some((b) => b.check_in <= dk && b.check_out > dk);
                                const coveredByBlock = ms.some((m: any) => m.start_date <= dk && m.end_date > dk);
                                if (coveredByBooking || coveredByBlock) return null;
                                return (
                                  <button
                                    onClick={() => setVacantAction({ room: r, date: dk })}
                                    className="absolute inset-1 rounded-md border border-dashed border-border opacity-0 group-hover/cell:opacity-100 hover:border-gold/50 hover:bg-gold-soft/20 text-muted-foreground hover:text-gold flex items-center justify-center transition"
                                    title="Vacant — click for actions"
                                    aria-label="Vacant room actions"
                                  >
                                    <Plus className="h-3.5 w-3.5" />
                                  </button>
                                );
                              })()}
                              {startingBookings.map((b) => {
                                const startCol = b.check_in < rangeStart ? 0 : dayKeys.indexOf(b.check_in);
                                const outIdx = dayKeys.indexOf(b.check_out);
                                const endCol = outIdx < 0 ? DAY_COUNT : outIdx;
                                const span = endCol - startCol;
                                if (span <= 0) return null;
                                const cellW = CELL_W_MOB;
                                const hasBreakfast = breakfastByBooking.get(b.id);
                                const balanceDue = Math.max(0, Number(b.amount) - Number(b.advance_paid || 0));
                                return (
                                  <button key={b.id} onClick={() => setSelected(b)}
                                    className={cn(
                                      "absolute top-1.5 bottom-1.5 left-1 rounded-full border-2 px-2 text-[11px] text-left flex items-center gap-1 overflow-hidden hover:ring-2 hover:ring-gold/50 transition shadow-sm",
                                      blockClasses(b.status),
                                      b._virtual && "border-dashed",
                                    )}
                                    style={{ width: `calc(${span} * ${cellW}px - 8px)`, zIndex: 5 }}
                                    title={(b._virtual ? "Unassigned · " : "") + `${b.guest_name} · ${b.status}${balanceDue > 0 ? ` · Due ₹${balanceDue.toLocaleString("en-IN")}` : ""}`}>
                                    {hasBreakfast && <UtensilsCrossed className="h-3 w-3 shrink-0 opacity-90" />}
                                    {balanceDue > 0 && <span className="shrink-0" aria-label="Balance due">💳</span>}
                                    <span className="truncate font-medium">{b.guest_name}{b._virtual ? " *" : ""}</span>
                                  </button>
                                );
                              })}
                              {startingBlocks.map((m: any) => {
                                const startCol = m.start_date < rangeStart ? 0 : dayKeys.indexOf(m.start_date);
                                const outIdx = dayKeys.indexOf(m.end_date);
                                const endCol = outIdx < 0 ? DAY_COUNT : outIdx;
                                const span = Math.max(1, endCol - startCol);
                                const cellW = CELL_W_MOB;
                                return (
                                  <button key={m.id} onClick={() => setSelectedBlock(m)}
                                    className="absolute top-1.5 bottom-1.5 left-1 rounded-full border-2 px-2 text-[11px] text-left flex items-center gap-1 overflow-hidden shadow-sm bg-amber-700 text-white border-amber-900 hover:ring-2 hover:ring-amber-400"
                                    style={{ width: `calc(${span} * ${cellW}px - 8px)`, zIndex: 5 }}
                                    title={`Blocked: ${m.reason || "Maintenance"}`}>
                                    <AlertTriangle className="h-3 w-3 shrink-0" />
                                    <span className="truncate">{m.reason || "Blocked"}</span>
                                  </button>
                                );
                              })}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Legend */}
        <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground">
          <Legend cls="bg-white border-gray-500" label="Pending / Confirmed" />
          <Legend cls="bg-blue-500/85 border-blue-700" label="Advance / Full Paid" />
          <Legend cls="bg-green-500/85 border-green-700" label="Checked-In" />
          <Legend cls="bg-gray-400/70 border-gray-600" label="Checked-Out / Stay Completed" />
          <Legend cls="bg-amber-700 border-amber-900" label="Blocked / Maintenance" />
          <Legend cls="bg-card border-border border-dashed" label="Unassigned (shown in vacant room)" />
          <div className="flex items-center gap-1.5"><UtensilsCrossed className="h-3 w-3 text-gold" /> Breakfast included</div>
          <div className="flex items-center gap-1.5"><span>💳</span> Balance due</div>
        </div>
      </div>

      {selected && <BookingPopover b={selected} onClose={() => setSelected(null)} rooms={rooms}
        hasBreakfast={!!breakfastByBooking.get(selected.id)} />}
      {selectedBlock && <BlockPopover m={selectedBlock} onClose={() => setSelectedBlock(null)} rooms={rooms}
        onEdit={() => { setEditBlock(selectedBlock); setSelectedBlock(null); }} />}
      {editBlock && (() => {
        const room = rooms.find((r: any) => r.id === editBlock.room_id);
        return (
          <BlockRoomDialog roomId={editBlock.room_id} roomNumber={room?.room_number ?? ""}
            existing={editBlock} onClose={() => setEditBlock(null)} />
        );
      })()}
      {vacantAction && (
        <VacantActionMenu room={vacantAction.room} date={vacantAction.date}
          onBlock={() => {
            // Open BlockRoomDialog with a one-day default starting from the clicked cell
            const next = new Date(vacantAction.date); next.setDate(next.getDate() + 1);
            setEditBlock({
              room_id: vacantAction.room.id,
              start_date: vacantAction.date,
              end_date: toLocalYMD(next),
              reason: "Maintenance",
              active: true,
              blocked_at: new Date().toISOString(),
              id: "", // sentinel — BlockRoomDialog treats falsy id as "new"
            } as any);
            setVacantAction(null);
          }}
          onClose={() => setVacantAction(null)} />
      )}

      {statsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setStatsOpen(false)}>
          <div className="luxe-card rounded-xl w-full max-w-2xl p-5 space-y-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-display text-xl flex items-center gap-2"><Hotel className="h-5 w-5 text-gold" /> House Overview</h3>
              <button onClick={() => setStatsOpen(false)} className="p-1 text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <Stat label="Occupied" value={occupiedRooms.size} />
              <Stat label="Vacant" value={vacant} />
              <Stat label="Arrivals Today" value={arrivalsToday} />
              <Stat label="Departures Today" value={departuresToday} />
              <Stat label="Occupancy" value={`${occPct}%`} />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="luxe-card rounded-xl p-4">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Guests In-House</div>
                <div className="font-display text-2xl gold-text-gradient">{adultsInHouse}A, {childrenInHouse}C</div>
                {inHouseRoomNumbers.length > 0 && (
                  <div className="text-[11px] text-muted-foreground mt-1">Rooms: {inHouseRoomNumbers.join(", ")}</div>
                )}
              </div>
              <div className="luxe-card rounded-xl p-4">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1 flex items-center gap-1.5">
                  <UtensilsCrossed className="h-3 w-3 text-gold" /> Breakfast Count
                </div>
                <div className="font-display text-2xl gold-text-gradient">{adultsBreakfast}A, {childrenBreakfast}C</div>
                {breakfastRoomNumbers.length > 0 && (
                  <div className="text-[11px] text-muted-foreground mt-1">Rooms: {breakfastRoomNumbers.join(", ")}</div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Stat({ label, value }: { label: string; value: any }) {
  return (
    <div className="luxe-card rounded-xl p-4">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="font-display text-2xl gold-text-gradient">{value}</div>
    </div>
  );
}
function Legend({ cls, label }: { cls: string; label: string }) {
  return <div className="flex items-center gap-1.5"><span className={cn("inline-block h-3 w-6 rounded-full border-2", cls)} />{label}</div>;
}

function BookingPopover({ b, onClose, rooms, hasBreakfast }: { b: any; onClose: () => void; rooms: any[]; hasBreakfast: boolean }) {
  const qc = useQueryClient();
  const room = rooms.find((r: any) => r.id === b.room_id);
  const balance = Math.max(0, Number(b.amount) - Number(b.advance_paid || 0));
  const today = dateKey(new Date());
  const status = b.status as string;
  const [payOpen, setPayOpen] = useState(false);
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const isCheckedOut = status === "Checked-Out" || status === "Stay Completed";

  const { data: itemsForInvoice = [] } = useQuery({
    queryKey: ["booking-items", b.id],
    queryFn: async () => {
      const { listBookingItems } = await import("@/lib/booking-items-api");
      return listBookingItems(b.id);
    },
    enabled: invoiceOpen,
  });
  const { data: paymentsForInvoice = [] } = useQuery({
    queryKey: ["booking-payments", b.id],
    queryFn: () => listBookingPayments(b.id),
    enabled: invoiceOpen,
  });

  const checkInMut = useMutation({
    mutationFn: async () => {
      const { setBookingStatus } = await import("@/lib/bookings-api");
      await setBookingStatus(b.id, "Checked-In" as any);
    },
    onSuccess: () => {
      toast.success("Checked-in");
      qc.invalidateQueries({ queryKey: ["bookings"] });
      onClose();
    },
    onError: (e: any) => toast.error(e.message),
  });
  const checkOutMut = useMutation({
    mutationFn: async () => {
      const { setBookingStatus } = await import("@/lib/bookings-api");
      await setBookingStatus(b.id, "Checked-Out" as any);
    },
    onSuccess: () => {
      toast.success("Checked-out");
      qc.invalidateQueries({ queryKey: ["bookings"] });
      onClose();
    },
    onError: (e: any) => toast.error(e.message),
  });

  // Dynamic action button (P5):
  //   Case 1: Balance > 0 (not yet checked-out)  → Add Payment
  //   Case 2: Balance = 0 AND today >= check_in AND not yet in-house  → Check-In
  //   Case 3: status = Checked-In                                     → Check-Out
  //   Case 4: status = Checked-Out / Stay Completed                   → View Booking only
  let primary: { label: string; onClick: () => void; tone?: "gold" | "green" | "blue" } | null = null;
  if (status !== "Checked-Out" && status !== "Stay Completed" && status !== "Cancelled") {
    if (status === "Checked-In") {
      primary = { label: "Check-Out", onClick: () => checkOutMut.mutate(), tone: "blue" };
    } else if (balance > 0) {
      primary = { label: "Add Payment", onClick: () => setPayOpen(true), tone: "gold" };
    } else if (today >= b.check_in) {
      primary = { label: "Check-In", onClick: () => checkInMut.mutate(), tone: "green" };
    }
  }

  const toneCls = (t?: string) =>
    t === "green" ? "bg-green-600 text-white hover:bg-green-700" :
    t === "blue" ? "bg-blue-600 text-white hover:bg-blue-700" :
    "gold-gradient text-charcoal";

  return (
    <>
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="luxe-card rounded-xl w-full max-w-md p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div>
            <h3 className="font-display text-xl">{b.guest_name}</h3>
            <div className="text-xs text-muted-foreground font-mono">{b.booking_reference}</div>
          </div>
          <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <Field label="Room" value={room ? `Room ${room.room_number}` : "Unassigned"} />
          <Field label="Status" value={b.status} />
          <Field label="Check-In" value={fmtFull(b.check_in)} />
          <Field label="Check-Out" value={fmtFull(b.check_out)} />
          <Field label="Guests" value={`${b.adults} Adult${b.adults === 1 ? "" : "s"}${b.children ? ` + ${b.children}` : ""}`} />
          <Field label="Breakfast" value={hasBreakfast ? "Included" : "Not Included"} />
          {(b as any).expected_arrival_at && b.status !== "Checked-In" && b.status !== "Checked-Out" && b.status !== "Stay Completed" && (
            <Field label="Expected Arrival" value={new Date((b as any).expected_arrival_at).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false })} />
          )}
          {b.phone && <Field label="Mobile" value={b.phone} icon={<Phone className="h-3 w-3" />} />}
        </div>
        {(b as any).special_requests && (
          <div className="rounded-md border border-gold/40 bg-gold-soft/40 px-3 py-2 text-xs">
            <div className="text-[10px] uppercase tracking-wider text-gold mb-1">Special Requests</div>
            <div className="text-foreground whitespace-pre-wrap">{(b as any).special_requests}</div>
          </div>
        )}
        <div className="rounded-md bg-secondary/40 border border-border px-3 py-2 text-xs space-y-1">
          <div className="flex justify-between"><span className="text-muted-foreground">Amount</span><span className="tabular-nums">₹{Number(b.amount).toLocaleString("en-IN")}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Advance Paid</span><span className="tabular-nums">₹{Number(b.advance_paid || 0).toLocaleString("en-IN")}</span></div>
          <div className="flex justify-between border-t border-border/50 pt-1"><span className="font-medium">Balance Due</span><span className="font-display text-base gold-text-gradient">₹{balance.toLocaleString("en-IN")}</span></div>
        </div>
        <div className="flex flex-wrap gap-2 pt-1">
          <Link to="/bookings/$id" params={{ id: b.id }} className="flex-1 text-center rounded-md border border-border bg-card px-3 py-2 text-xs hover:border-gold/40">View Booking</Link>
          {isCheckedOut && (
            <button onClick={() => setInvoiceOpen(true)}
              className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-md border border-gold/40 bg-gold-soft text-gold px-3 py-2 text-xs font-medium hover:bg-gold/20">
              <FileText className="h-3 w-3" /> Invoice
            </button>
          )}
          {primary && (
            <button onClick={primary.onClick}
              disabled={checkInMut.isPending || checkOutMut.isPending}
              className={cn("flex-1 text-center rounded-md px-3 py-2 text-xs font-medium disabled:opacity-60", toneCls(primary.tone))}>
              {(checkInMut.isPending || checkOutMut.isPending) ? "Working…" : primary.label}
            </button>
          )}
        </div>
      </div>
    </div>
    {payOpen && (
      <AddBookingPaymentModal
        bookingId={b.id} customerId={b.customer_id} maxAmount={balance}
        onClose={() => setPayOpen(false)}
        onSaved={() => onClose()}
      />
    )}
    {invoiceOpen && (
      <InvoiceDialog booking={b} items={itemsForInvoice as any} payments={paymentsForInvoice}
        onClose={() => setInvoiceOpen(false)} />
    )}
    </>
  );
}

function BlockPopover({ m, onClose, rooms, onEdit }: { m: any; onClose: () => void; rooms: any[]; onEdit: () => void }) {
  const room = rooms.find((r: any) => r.id === m.room_id);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="luxe-card rounded-xl w-full max-w-sm p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <h3 className="font-display text-xl flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-amber-600" /> Blocked Room</h3>
          <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <Field label="Room" value={room ? `Room ${room.room_number}` : "—"} />
          <Field label="From" value={fmtFull(m.start_date)} />
          <Field label="To" value={fmtFull(m.end_date)} />
        </div>
        <div className="text-sm">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Reason</div>
          <div>{m.reason || "Maintenance"}</div>
        </div>
        {(m.blocked_at || m.unblocked_at) && (
          <div className="rounded-md border border-border bg-secondary/30 p-2 text-[11px] text-muted-foreground space-y-0.5">
            {m.blocked_at && <div>Blocked: {new Date(m.blocked_at).toLocaleString("en-IN")}</div>}
            {m.unblocked_at && <div>Unblocked: {new Date(m.unblocked_at).toLocaleString("en-IN")}</div>}
          </div>
        )}
        <button onClick={onEdit} className="w-full gold-gradient text-charcoal rounded-md px-3 py-2 text-xs font-medium">
          Edit / Unblock
        </button>
      </div>
    </div>
  );
}

function VacantActionMenu({ room, date, onBlock, onClose }: { room: any; date: string; onBlock: () => void; onClose: () => void }) {
  const next = new Date(date); next.setDate(next.getDate() + 1);
  const nextKey = toLocalYMD(next);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="luxe-card rounded-xl w-full max-w-sm p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div>
            <h3 className="font-display text-xl">Vacant · Room {room.room_number}</h3>
            <div className="text-xs text-muted-foreground">{room.room_type} · {fmtFull(date)}</div>
          </div>
          <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
        <Link
          to="/bookings/new"
          search={{ roomId: room.id, roomType: room.room_type, checkIn: date, checkOut: nextKey }}
          onClick={onClose}
          className="w-full inline-flex items-center justify-center gap-2 gold-gradient text-charcoal rounded-md px-3 py-2.5 text-sm font-medium"
        >
          <Plus className="h-4 w-4" /> Create Booking
        </Link>
        <button
          onClick={onBlock}
          className="w-full inline-flex items-center justify-center gap-2 rounded-md border border-amber-600/40 bg-amber-600/10 text-amber-800 dark:text-amber-300 px-3 py-2.5 text-sm font-medium hover:bg-amber-600/20"
        >
          <Ban className="h-4 w-4" /> Block Room
        </button>
      </div>
    </div>
  );
}

function Field({ label, value, icon }: { label: string; value: string; icon?: any }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-xs flex items-center gap-1">{icon}{value}</div>
    </div>
  );
}
