import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Topbar } from "@/components/topbar";
import { listRooms } from "@/lib/rooms-api";
import { listBookings } from "@/lib/bookings-api";
import { ChevronLeft, ChevronRight, Loader2, X, Phone, BarChart3 } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/house-view")({
  component: HouseView,
});

const DAY_COUNT = 7;
const CELL_W = 96;
const CELL_W_MOB = 88;

function dateKey(d: Date) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function addDays(d: Date, n: number) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function fmtShort(d: Date) { return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" }); }
function fmtFull(d: string) { return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }); }

/** Pick block color from booking status. */
function blockColor(status: string): string {
  switch (status) {
    case "Checked-In": return "bg-success/80 text-charcoal border-success";
    case "Checked-Out": case "Stay Completed": return "bg-muted/60 text-muted-foreground border-border";
    case "Advance Paid": case "Full Paid": return "bg-blue-500/80 text-white border-blue-600";
    case "Cancelled": return "bg-destructive/30 text-foreground border-destructive/40 line-through";
    default: return "bg-card border-border text-foreground";
  }
}

function datesOverlap(aIn: string, aOut: string, bIn: string, bOut: string) {
  return aIn < bOut && bIn < aOut;
}

function HouseView() {
  const [anchor, setAnchor] = useState(() => { const t = new Date(); t.setHours(0,0,0,0); return t; });
  const [selected, setSelected] = useState<any | null>(null);
  const [statsOpen, setStatsOpen] = useState(false);

  const { data: rooms = [], isLoading: lr } = useQuery({ queryKey: ["rooms", "active"], queryFn: () => listRooms(true) });
  const { data: bookings = [], isLoading: lb } = useQuery({ queryKey: ["bookings"], queryFn: listBookings });
  const isLoading = lr || lb;

  const days = useMemo(() => Array.from({ length: DAY_COUNT }, (_, i) => addDays(anchor, i)), [anchor]);
  const dayKeys = days.map(dateKey);
  const rangeStart = dayKeys[0];
  const rangeEnd = dateKey(addDays(anchor, DAY_COUNT));

  const visibleBookings = useMemo(
    () => (bookings as any[]).filter((b) => b.status !== "Cancelled" && b.check_in < rangeEnd && b.check_out > rangeStart),
    [bookings, rangeStart, rangeEnd],
  );

  /**
   * Group bookings by room. Unassigned bookings are greedily placed into vacant rooms
   * that have no conflict over the booking's date range. Display-only — does not persist.
   */
  const byRoom = useMemo(() => {
    const m = new Map<string, any[]>();
    const assigned = visibleBookings.filter((b) => b.room_id);
    const unassigned = visibleBookings.filter((b) => !b.room_id);
    for (const b of assigned) {
      const arr = m.get(b.room_id) ?? [];
      arr.push(b); m.set(b.room_id, arr);
    }
    // Greedy place unassigned into rooms with no overlap
    for (const b of unassigned) {
      let placed = false;
      for (const r of rooms) {
        const arr = m.get(r.id) ?? [];
        const conflict = arr.some((x) => datesOverlap(b.check_in, b.check_out, x.check_in, x.check_out));
        if (!conflict) {
          arr.push({ ...b, _virtual: true });
          m.set(r.id, arr);
          placed = true;
          break;
        }
      }
      if (!placed) {
        // fall back: stick it on first room (will visually overlap, but visible)
        const fr = rooms[0];
        if (fr) {
          const arr = m.get(fr.id) ?? [];
          arr.push({ ...b, _virtual: true });
          m.set(fr.id, arr);
        }
      }
    }
    return m;
  }, [visibleBookings, rooms]);

  // Stats
  const todayKey = dateKey(new Date());
  const occupiedRooms = new Set<string>();
  let arrivalsToday = 0, departuresToday = 0;
  for (const b of (bookings as any[])) {
    if (b.status === "Cancelled") continue;
    if (b.check_in === todayKey) arrivalsToday++;
    if (b.check_out === todayKey) departuresToday++;
    if (b.room_id && b.check_in <= todayKey && b.check_out > todayKey && b.status !== "Checked-Out" && b.status !== "Stay Completed") {
      occupiedRooms.add(b.room_id);
    }
  }
  const totalRooms = rooms.length;
  const vacant = totalRooms - occupiedRooms.size;
  const occPct = totalRooms ? Math.round((occupiedRooms.size / totalRooms) * 100) : 0;
  const oakRooms = rooms.filter(r => r.room_type === "Oak");
  const mappleRooms = rooms.filter(r => r.room_type === "Mapple");
  const oakOcc = oakRooms.filter(r => occupiedRooms.has(r.id)).length;
  const mappleOcc = mappleRooms.filter(r => occupiedRooms.has(r.id)).length;

  return (
    <>
      <Topbar title="House View" subtitle="Room occupancy at a glance" />
      <div className="px-4 md:px-8 py-6 md:py-8 max-w-[1600px] space-y-6">

        {/* Navigation + Stats trigger */}
        <div className="luxe-card rounded-xl p-4 flex items-center justify-between gap-3">
          <button onClick={() => setAnchor((d) => addDays(d, -1))} className="p-2 rounded-md border border-border hover:border-gold/40"><ChevronLeft className="h-4 w-4" /></button>
          <div className="flex items-center gap-2 flex-wrap justify-center">
            <input type="date" value={dateKey(anchor)} onChange={(e) => { const d = new Date(e.target.value); if (!isNaN(d.getTime())) setAnchor(d); }}
              className="bg-input/60 border border-border rounded-md px-3 py-1.5 text-sm" />
            <button onClick={() => { const t = new Date(); t.setHours(0,0,0,0); setAnchor(t); }}
              className="px-3 py-1.5 rounded-md border border-border text-xs hover:border-gold/40">Today</button>
            <button onClick={() => setStatsOpen(true)}
              className="px-3 py-1.5 rounded-md border border-gold/40 bg-gold-soft/30 text-xs hover:bg-gold-soft/50 flex items-center gap-1.5">
              <BarChart3 className="h-3.5 w-3.5" /> Statistics
            </button>
          </div>
          <button onClick={() => setAnchor((d) => addDays(d, 1))} className="p-2 rounded-md border border-border hover:border-gold/40"><ChevronRight className="h-4 w-4" /></button>
        </div>

        {/* Grid */}
        {isLoading ? (
          <div className="p-12 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-gold" /></div>
        ) : (
          <div className="luxe-card rounded-xl p-3 overflow-x-auto">
            <div className="min-w-fit">
              {/* header row */}
              <div className="grid sticky top-0 z-10 bg-card" style={{ gridTemplateColumns: `120px repeat(${DAY_COUNT}, minmax(${CELL_W_MOB}px, ${CELL_W}px))` }}>
                <div className="px-2 py-2 text-[10px] uppercase tracking-wider text-muted-foreground border-b-2 border-border">Room</div>
                {days.map((d) => {
                  const isToday = dateKey(d) === todayKey;
                  return (
                    <div key={d.toISOString()} className={cn("px-2 py-2 text-[10px] uppercase tracking-wider border-b-2 border-border text-center",
                      isToday ? "text-gold bg-gold-soft/40" : "text-muted-foreground")}>
                      <div>{d.toLocaleDateString("en-IN", { weekday: "short" })}</div>
                      <div className="text-foreground text-xs">{fmtShort(d)}</div>
                    </div>
                  );
                })}
              </div>

              {/* room rows */}
              {rooms.map((r) => {
                const bs = byRoom.get(r.id) ?? [];
                return (
                  <div key={r.id} className="grid border-b border-border"
                    style={{ gridTemplateColumns: `120px repeat(${DAY_COUNT}, minmax(${CELL_W_MOB}px, ${CELL_W}px))`, gridAutoRows: "minmax(56px, auto)" }}>
                    <div className="px-2 py-3 text-xs border-r border-border" style={{ gridRow: 1, gridColumn: 1 }}>
                      <div className="font-medium">Room {r.room_number}</div>
                      <div className="text-[10px] text-muted-foreground">{r.room_type} · F{r.floor}</div>
                    </div>
                    {days.map((_, i) => (
                      <div key={i} className="border-r border-border/70" style={{ gridRow: 1, gridColumn: i + 2 }} />
                    ))}
                    {bs.map((b) => {
                      const startCol = b.check_in < rangeStart ? 0 : Math.max(0, dayKeys.indexOf(b.check_in));
                      const outIdx = dayKeys.indexOf(b.check_out);
                      const endCol = outIdx < 0 ? DAY_COUNT : outIdx;
                      const span = endCol - startCol;
                      if (span <= 0) return null;
                      return (
                        <button key={b.id} onClick={() => setSelected(b)}
                          className={cn("m-1 rounded-md border px-2 text-[11px] text-left flex items-center overflow-hidden hover:ring-2 hover:ring-gold/40 transition",
                            blockColor(b.status),
                            b._virtual && "border-dashed")}
                          style={{ gridRow: 1, gridColumn: `${startCol + 2} / span ${span}` }}
                          title={b._virtual ? "Unassigned — shown in a vacant room" : ""}>
                          <span className="truncate font-medium">{b.guest_name}{b._virtual ? " *" : ""}</span>
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Legend */}
        <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground">
          <Legend cls="bg-card border-border" label="Pending / Confirmed" />
          <Legend cls="bg-blue-500/80 border-blue-600" label="Advance / Full Paid" />
          <Legend cls="bg-success/80 border-success" label="Checked-In" />
          <Legend cls="bg-muted/60 border-border" label="Checked-Out" />
          <Legend cls="bg-card border-border border-dashed" label="Unassigned (shown in vacant room)" />
        </div>
      </div>

      {selected && <BookingPopover b={selected} onClose={() => setSelected(null)} rooms={rooms} />}
      {statsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setStatsOpen(false)}>
          <div className="luxe-card rounded-xl w-full max-w-2xl p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-display text-xl">Statistics</h3>
              <button onClick={() => setStatsOpen(false)} className="p-1 text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <Stat label="Occupied" value={occupiedRooms.size} />
              <Stat label="Vacant" value={vacant} />
              <Stat label="Arrivals Today" value={arrivalsToday} />
              <Stat label="Departures Today" value={departuresToday} />
              <Stat label="Occupancy" value={`${occPct}%`} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <TypeStat label="Oak" occupied={oakOcc} total={oakRooms.length} />
              <TypeStat label="Mapple" occupied={mappleOcc} total={mappleRooms.length} />
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
function TypeStat({ label, occupied, total }: { label: string; occupied: number; total: number }) {
  return (
    <div className="luxe-card rounded-xl p-4">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{label} Rooms</div>
      <div className="flex items-baseline gap-3">
        <div><span className="font-display text-xl gold-text-gradient">{occupied}</span><span className="text-xs text-muted-foreground ml-1">occupied</span></div>
        <div><span className="font-display text-xl">{total - occupied}</span><span className="text-xs text-muted-foreground ml-1">vacant</span></div>
      </div>
    </div>
  );
}
function Legend({ cls, label }: { cls: string; label: string }) {
  return <div className="flex items-center gap-1.5"><span className={cn("inline-block h-3 w-5 rounded-sm border", cls)} />{label}</div>;
}

function BookingPopover({ b, onClose, rooms }: { b: any; onClose: () => void; rooms: any[] }) {
  const room = rooms.find((r: any) => r.id === b.room_id);
  const balance = Math.max(0, Number(b.amount) - Number(b.advance_paid || 0));
  return (
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
          {b.phone && <Field label="Mobile" value={b.phone} icon={<Phone className="h-3 w-3" />} />}
        </div>
        <div className="rounded-md bg-secondary/40 border border-border px-3 py-2 text-xs space-y-1">
          <div className="flex justify-between"><span className="text-muted-foreground">Amount</span><span className="tabular-nums">₹{Number(b.amount).toLocaleString("en-IN")}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Advance Paid</span><span className="tabular-nums">₹{Number(b.advance_paid || 0).toLocaleString("en-IN")}</span></div>
          <div className="flex justify-between border-t border-border/50 pt-1"><span className="font-medium">Balance Due</span><span className="font-display text-base gold-text-gradient">₹{balance.toLocaleString("en-IN")}</span></div>
        </div>
        <div className="flex gap-2 pt-1">
          <Link to="/bookings/$id" params={{ id: b.id }} className="flex-1 text-center rounded-md gold-gradient px-3 py-2 text-xs font-medium text-charcoal">View Booking</Link>
          <Link to="/bookings/$id/edit" params={{ id: b.id }} className="flex-1 text-center rounded-md border border-border bg-card px-3 py-2 text-xs">Assign Room</Link>
        </div>
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
