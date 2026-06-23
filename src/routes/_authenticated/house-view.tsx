import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Topbar } from "@/components/topbar";
import { listRooms, listMaintenance } from "@/lib/rooms-api";
import { listBookings } from "@/lib/bookings-api";
import { listBookingItems } from "@/lib/booking-items-api";
import { supabase } from "@/integrations/supabase/client";
import { ChevronLeft, ChevronRight, Loader2, X, Phone, Hotel, UtensilsCrossed, AlertTriangle, FileText, Plus, Ban, MessageCircle, Link2, ShieldCheck } from "lucide-react";
import { NightAuditDialog } from "@/components/night-audit-dialog";
import { useOpsTimeLabels } from "@/lib/check-times";
import { cn, toLocalYMD, smartArrival } from "@/lib/utils";
import { toast } from "sonner";
import { AddBookingPaymentModal } from "@/components/add-booking-payment-modal";
import { InvoiceDialog } from "@/components/invoice-dialog";
import { listBookingPayments } from "@/lib/booking-payments-api";
import { bookingWhatsAppLink, paymentReminderMessage } from "@/lib/booking-messages";
import { issueBookingToken } from "@/lib/portal.functions";
import { publicOrigin } from "@/lib/public-url";
import { BlockRoomDialog } from "@/components/block-room-dialog";
import { useCheckInController } from "@/lib/check-in-flow";
import { ChargeFormDialog } from "@/components/in-house-charges-section";
import { useMasterData } from "@/hooks/use-master-data";
import { MetricCard, Money } from "@/components/money";
import {
  groupStayAssignments, groupStayItems, pairStaySlotsToRooms,
  segmentCoversDate, segmentOverlapsRange, segmentsOverlap, stayRoomTypesMatch, slotEndExclusive,
} from "@/lib/stay-segments";

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

/** YYYY-MM-DD arithmetic helpers for drag-and-drop date shifts. */
function ymdAddDays(ymd: string, n: number): string {
  const d = new Date(ymd + "T00:00:00");
  d.setDate(d.getDate() + n);
  return dateKey(d);
}
function ymdDiffDays(a: string, b: string): number {
  // a - b in whole days
  const da = new Date(a + "T00:00:00").getTime();
  const db = new Date(b + "T00:00:00").getTime();
  return Math.round((da - db) / (24 * 60 * 60 * 1000));
}

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
    case "No-Show":
      return "bg-destructive/60 text-white border-destructive line-through";
    case "Pending":
    case "Confirmed":
    default:
      return "bg-white text-gray-900 border-gray-500 dark:bg-zinc-100 dark:text-zinc-900 dark:border-zinc-400";
  }
}

function HouseView() {
  // Business date is the source of truth for "today" in operations.
  // Fall back to system date until the query resolves so the grid still renders.
  const { data: businessDate } = useQuery({
    queryKey: ["business-date"],
    queryFn: async () => {
      const { getBusinessDate } = await import("@/lib/night-audit-api");
      return getBusinessDate();
    },
    staleTime: 60_000,
  });
  const [anchor, setAnchor] = useState(() => { const t = new Date(); t.setHours(0,0,0,0); return t; });
  // When business date arrives the first time, snap the grid anchor onto it.
  const [anchorBound, setAnchorBound] = useState(false);
  if (!anchorBound && businessDate) {
    setAnchorBound(true);
    // Show one day BEFORE business date so reception can still complete
    // pending check-outs / actions from the previous day.
    const d = new Date(businessDate + "T00:00:00");
    if (!isNaN(d.getTime())) { d.setDate(d.getDate() - 1); setAnchor(d); }
  }
  const [selected, setSelected] = useState<any | null>(null);
  const [selectedBlock, setSelectedBlock] = useState<any | null>(null);
  const [editBlock, setEditBlock] = useState<any | null>(null);
  const [vacantAction, setVacantAction] = useState<{ room: any; date: string } | null>(null);
  const [statsOpen, setStatsOpen] = useState(false);
  const [searchQ, setSearchQ] = useState("");
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [auditOpen, setAuditOpen] = useState(false);

  const { data: rooms = [], isLoading: lr } = useQuery({ queryKey: ["rooms", "active"], queryFn: () => listRooms(true) });
  const { data: bookings = [], isLoading: lb } = useQuery({ queryKey: ["bookings"], queryFn: listBookings });
  const { data: blocks = [] } = useQuery({
    queryKey: ["room_maintenance", "active"],
    queryFn: async () => (await listMaintenance()).filter((m: any) => m.active !== false),
  });
  // All booking items (breakfast lookup + room_type/rooms per item for placeholder occupancy)
  const { data: allItems = [] } = useQuery({
    queryKey: ["booking-items-all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("booking_items" as any)
        .select("booking_id,position,breakfast_included,room_type,rooms,check_in,check_out");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
  // Multi-room assignments — drives per-room occupancy in House View.
  const { data: allAssignments = [] } = useQuery({
    queryKey: ["booking-room-assignments-all"],
    queryFn: async () => {
      const { data, error } = await supabase.from("booking_room_assignments" as any).select("booking_id,room_id,created_at");
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

  const itemsByBooking = useMemo(() => groupStayItems(allItems as any[]), [allItems]);
  const assignmentsByBooking = useMemo(() => groupStayAssignments(allAssignments as any[]), [allAssignments]);

  const visibleBookings = useMemo(
    () => (bookings as any[]).filter((b) => {
      if (b.status === "Cancelled" || b.status === "No-Show") return false;
      const { slots } = pairStaySlotsToRooms(b, itemsByBooking, assignmentsByBooking, rooms as any[]);
      return slots.some((slot) => segmentOverlapsRange(slot, rangeStart, rangeEnd));
    }),
    [bookings, itemsByBooking, assignmentsByBooking, rooms, rangeStart, rangeEnd],
  );

  // Blocks (maintenance) visible in range
  const visibleBlocks = useMemo(
    () => (blocks as any[]).filter((m) => m.start_date < rangeEnd && m.end_date > rangeStart),
    [blocks, rangeStart, rangeEnd],
  );

  /**
   * Place bookings into rooms. Multi-room aware with per-type placeholders:
   *   - For each booking, render once per ASSIGNED room.
   *   - Compute the remaining-rooms-by-type from booking_items minus already-assigned
   *     rooms of that type. For each remaining slot, place a VIRTUAL placeholder
   *     into the first vacant room of the matching type (falls back to any vacant
   *     room when no type match is available).
   *   - Bookings with no items default to 1 virtual placeholder (any vacant room).
   */
  const byRoom = useMemo(() => {
    const m = new Map<string, any[]>();
    const conflictsAt = (rid: string, slot: any) =>
      (m.get(rid) ?? []).some((x) => segmentsOverlap(slot, x));

    // 1) Render each booking only on rooms paired to active stay segments.
    for (const b of visibleBookings) {
      const { paired } = pairStaySlotsToRooms(b, itemsByBooking, assignmentsByBooking, rooms as any[]);
      for (const { room_id: rid, slot } of paired) {
        if (!segmentOverlapsRange(slot, rangeStart, rangeEnd)) continue;
        const arr = m.get(rid) ?? [];
        arr.push({ ...b, room_id: rid, check_in: slot.check_in, check_out: slot.check_out, _slotKey: slot.key });
        m.set(rid, arr);
      }
    }

    // 2) Place virtual placeholders only for unpaired stay segments overlapping this date range.
    for (const b of visibleBookings) {
      const { paired, unpaired } = pairStaySlotsToRooms(b, itemsByBooking, assignmentsByBooking, rooms as any[]);
      const assignedRoomIds = paired.map((p) => p.room_id);
      for (const slot of unpaired) {
        if (!segmentOverlapsRange(slot, rangeStart, rangeEnd)) continue;
        // Candidate rooms: matching type first, then any room as fallback.
        const matching = (rooms as any[]).filter((r) =>
          slot.room_type ? stayRoomTypesMatch(r.room_type, slot.room_type) : true,
        );
        const fallback = (rooms as any[]);
        const candidates = matching.length > 0 ? matching : fallback;

        let placed = false;
        for (const r of candidates) {
          // Skip rooms already assigned to this same booking (it's the same booking already shown).
          if (assignedRoomIds.includes(r.id)) continue;
          if (conflictsAt(r.id, slot)) continue;
          const arr = m.get(r.id) ?? [];
          arr.push({ ...b, room_id: r.id, check_in: slot.check_in, check_out: slot.check_out, _slotKey: slot.key, _virtual: true });
          m.set(r.id, arr);
          placed = true;
          break;
        }
        // If still unplaced, drop into the first matching room regardless (rare overflow).
        if (!placed && candidates[0]) {
          const arr = m.get(candidates[0].id) ?? [];
          arr.push({ ...b, room_id: candidates[0].id, check_in: slot.check_in, check_out: slot.check_out, _slotKey: slot.key, _virtual: true });
          m.set(candidates[0].id, arr);
        }
      }
    }

    // 3) Hide Checked-Out / Stay Completed bookings on a room once another
    //    booking has been assigned to that same room with overlapping dates.
    //    (Keeps the checked-out pill visible only until the room turns over.)
    for (const [rid, arr] of m) {
      const filtered = arr.filter((b) => {
        const isPast = b.status === "Checked-Out" || b.status === "Stay Completed";
        if (!isPast) return true;
        return !arr.some((other) =>
          other !== b
          && other.status !== "Checked-Out"
          && other.status !== "Stay Completed"
          && segmentsOverlap(b, other)
        );
      });
      m.set(rid, filtered);
    }
    return m;
  }, [visibleBookings, rooms, itemsByBooking, assignmentsByBooking, rangeStart, rangeEnd]);

  const blocksByRoom = useMemo(() => {
    const m = new Map<string, any[]>();
    for (const x of visibleBlocks) {
      const arr = m.get(x.room_id) ?? [];
      arr.push(x); m.set(x.room_id, arr);
    }
    return m;
  }, [visibleBlocks]);

  // -------- Drag & drop: move a booking to a new room and/or new date --------
  // Only enabled for single-room bookings (one paired assignment). The DB
  // triggers (`bookings_prevent_room_conflict`, `bookings_prevent_block_conflict`,
  // `bra_prevent_conflict`) enforce overlap / block rules — any violation throws
  // and we surface the message; React Query's onError reverts optimistic state.
  const qcMove = useQueryClient();
  const moveMutation = useMutation({
    mutationFn: async (opts: {
      bookingId: string;
      oldRoomId: string;
      newRoomId: string;
      newCheckIn: string;
      newCheckOut: string;
    }) => {
      // Update bookings first — its triggers enforce room/block conflict rules.
      const { error: bErr } = await supabase
        .from("bookings" as any)
        .update({ check_in: opts.newCheckIn, check_out: opts.newCheckOut, room_id: opts.newRoomId } as any)
        .eq("id", opts.bookingId);
      if (bErr) throw bErr;
      // Repoint the matching assignment row. `bra_prevent_conflict` also enforces overlap.
      const { error: aErr } = await supabase
        .from("booking_room_assignments" as any)
        .update({ room_id: opts.newRoomId } as any)
        .eq("booking_id", opts.bookingId)
        .eq("room_id", opts.oldRoomId);
      if (aErr) throw aErr;
    },
    onSuccess: () => {
      toast.success("Booking moved");
      qcMove.invalidateQueries({ queryKey: ["bookings"] });
      qcMove.invalidateQueries({ queryKey: ["booking-room-assignments-all"] });
    },
    onError: (e: any) => {
      const msg = String(e?.message ?? "Move failed");
      // Friendlier message for known trigger violations.
      if (/conflict|blocked|overlapping/i.test(msg)) {
        toast.error("Move cancelled — " + msg);
      } else {
        toast.error(msg);
      }
    },
  });

  function handleDropOnCell(targetRoomId: string, targetDate: string, payload: string) {
    try {
      const parsed = JSON.parse(payload) as {
        bookingId: string; oldRoomId: string; checkIn: string; checkOut: string;
      };
      const delta = ymdDiffDays(targetDate, parsed.checkIn);
      const newCheckIn = ymdAddDays(parsed.checkIn, delta);
      const newCheckOut = ymdAddDays(parsed.checkOut, delta);
      // No-op guard
      if (parsed.oldRoomId === targetRoomId && newCheckIn === parsed.checkIn) return;
      moveMutation.mutate({
        bookingId: parsed.bookingId,
        oldRoomId: parsed.oldRoomId,
        newRoomId: targetRoomId,
        newCheckIn,
        newCheckOut,
      });
    } catch {
      toast.error("Invalid drag payload");
    }
  }



  // -------- House Overview stats (for selected date = today) --------
  const todayKey = businessDate ?? dateKey(new Date());
  const occupiedRooms = new Set<string>();
  const inHouseBookings: any[] = [];
  let arrivalsToday = 0, departuresToday = 0;
  for (const b of (bookings as any[])) {
    if (b.status === "Cancelled" || b.status === "No-Show") continue;
    if (b.check_in === todayKey) arrivalsToday++;
    if (b.check_out === todayKey) departuresToday++;
    if (b.status === "Checked-Out" || b.status === "Stay Completed") continue;
    const { paired, slots } = pairStaySlotsToRooms(b, itemsByBooking, assignmentsByBooking, rooms as any[]);
    if (!slots.some((slot) => segmentCoversDate(slot, todayKey))) continue;
    inHouseBookings.push(b);
    for (const { room_id, slot } of paired) {
      if (segmentCoversDate(slot, todayKey)) occupiedRooms.add(room_id);
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
  const roomNumbersFor = (b: any): string[] =>
    pairStaySlotsToRooms(b, itemsByBooking, assignmentsByBooking, rooms as any[]).paired
      .filter(({ slot }) => segmentCoversDate(slot, todayKey))
      .map(({ room_id }) => roomNumber(room_id)).filter(Boolean) as string[];
  const breakfastRoomNumbers = breakfastBookings.flatMap(roomNumbersFor);
  const inHouseRoomNumbers = inHouseBookings.flatMap(roomNumbersFor);

  // ---------- Search ----------
  const normalized = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const normPhone = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");
  const searchMatches = useMemo(() => {
    const q = searchQ.trim();
    if (!q) return [] as any[];
    const qNorm = normalized(q);
    const qDigits = normPhone(q);
    return (bookings as any[]).filter((b) => {
      if (b.status === "Cancelled" || b.status === "No-Show") return false;
      const nameHit = qNorm.length >= 2 && normalized(b.guest_name).includes(qNorm);
      const refHit = qNorm.length >= 2 && normalized(b.booking_reference).includes(qNorm);
      const phoneHit = qDigits.length >= 3 && normPhone(b.phone).includes(qDigits);
      return nameHit || refHit || phoneHit;
    }).slice(0, 20);
  }, [searchQ, bookings]);

  function jumpToBooking(b: any) {
    // Snap anchor to the booking start (clamped to today if in past) and highlight
    const today = new Date(); today.setHours(0,0,0,0);
    const ci = new Date(b.check_in);
    const target = ci < today ? today : ci;
    target.setHours(0,0,0,0);
    setAnchor(target);
    setHighlightId(b.id);
    setSearchQ("");
    // Scroll into view shortly after rerender
    setTimeout(() => {
      const el = document.querySelector(`[data-booking-pill="${b.id}"]`) as HTMLElement | null;
      if (el && typeof el.scrollIntoView === "function") {
        el.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
      }
      setTimeout(() => setHighlightId(null), 2400);
    }, 80);
  }

  const todayLabel = (businessDate ? new Date(businessDate + "T00:00:00") : new Date())
    .toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  const systemLabel = new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

  return (
    <>
      <Topbar title="House View" subtitle={`Business Date: ${todayLabel}${businessDate && businessDate !== dateKey(new Date()) ? ` · System: ${systemLabel}` : ""}`}
        action={
          <button onClick={() => setAuditOpen(true)}
            className="px-3 py-1.5 rounded-md border border-gold/40 bg-gold-soft/30 text-xs hover:bg-gold-soft/50 flex items-center gap-1.5"
            title="Perform Night Audit">
            <ShieldCheck className="h-3.5 w-3.5" /> Night Audit
          </button>
        } />
      <div className="px-4 md:px-8 py-6 md:py-8 max-w-[1600px] space-y-4">

        <NightAuditPendingBanner onOpen={() => setAuditOpen(true)} businessDate={businessDate} />

        {/* Search */}
        <div className="luxe-card rounded-xl p-3">
          <div className="relative">
            <input
              type="text"
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && searchMatches.length > 0) jumpToBooking(searchMatches[0]);
                if (e.key === "Escape") setSearchQ("");
              }}
              placeholder="Search bookings, guests, mobile…"
              className="w-full bg-input/60 border border-border rounded-md pl-9 pr-9 py-2.5 text-sm placeholder:text-muted-foreground/60"
            />
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
            {searchQ && (
              <button onClick={() => setSearchQ("")} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            )}
            {searchQ.trim() && searchMatches.length > 0 && (
              <div className="absolute z-40 left-0 right-0 mt-1 luxe-card rounded-md max-h-80 overflow-auto shadow-xl">
                {searchMatches.map((m) => {
                  const roomNums = pairStaySlotsToRooms(m, itemsByBooking, assignmentsByBooking, rooms as any[]).paired
                    .map(({ room_id }) => (rooms as any[]).find((r) => r.id === room_id)?.room_number).filter(Boolean);
                  return (
                    <button key={m.id} onClick={() => jumpToBooking(m)}
                      className="w-full text-left px-3 py-2 border-b border-border last:border-b-0 hover:bg-gold-soft/20">
                      <div className="text-sm font-medium">{m.guest_name} <span className="text-[11px] text-muted-foreground">· {m.booking_reference}</span></div>
                      <div className="text-[11px] text-muted-foreground tabular">
                        {m.phone ? `+${normPhone(m.phone).replace(/^91/, "91 ")}` : "—"} · {fmtFull(m.check_in)} → {fmtFull(m.check_out)}
                        {roomNums.length > 0 ? ` · Room ${roomNums.join(", ")}` : ""}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
            {searchQ.trim() && searchMatches.length === 0 && (
              <div className="absolute z-40 left-0 right-0 mt-1 luxe-card rounded-md p-3 text-xs text-muted-foreground">No matching bookings.</div>
            )}
          </div>
        </div>

        {/* Navigation + House Overview header row */}
        <div className="luxe-card rounded-xl p-4 flex items-center justify-between gap-3">
          <button onClick={() => setAnchor((d) => addDays(d, -1))} className="p-2 rounded-md border border-border hover:border-gold/40"><ChevronLeft className="h-4 w-4" /></button>
          <div className="flex items-center gap-2 flex-wrap justify-center">
            <span className="hidden md:inline text-sm font-medium">House Overview</span>
            <input type="date" value={dateKey(anchor)} onChange={(e) => { const d = new Date(e.target.value); if (!isNaN(d.getTime())) setAnchor(d); }}
              className="bg-input/60 border border-border rounded-md px-3 py-1.5 text-sm" />
            <button onClick={() => { const d = businessDate ? new Date(businessDate + "T00:00:00") : new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate() - 1); setAnchor(d); }}
              className="px-3 py-1.5 rounded-md border border-border text-xs hover:border-gold/40">Business Date</button>
            <button onClick={() => setStatsOpen(true)}
              className="px-3 py-1.5 rounded-md border border-gold/40 bg-gold-soft/30 text-xs hover:bg-gold-soft/50 flex items-center gap-1.5">
              <Hotel className="h-3.5 w-3.5" /> Stats
            </button>
            <span className="text-[11px] text-muted-foreground tabular hidden md:inline">Today · {todayLabel}</span>
          </div>
          <button onClick={() => setAnchor((d) => addDays(d, 1))} className="p-2 rounded-md border border-border hover:border-gold/40"><ChevronRight className="h-4 w-4" /></button>
        </div>
        <NightAuditDialog open={auditOpen} onClose={() => setAuditOpen(false)} />

        {/* Grid */}
        {isLoading ? (
          <div className="p-12 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-gold" /></div>
        ) : (
          <div className="luxe-card rounded-xl p-0 overflow-auto relative max-h-[calc(100vh-220px)]">
            <table className="border-separate border-spacing-0 min-w-fit">
              <thead>
                <tr>
                  <th
                    className="sticky left-0 top-0 z-40 bg-card border-b-2 border-r-2 border-border px-2 py-2 text-[10px] uppercase tracking-wider text-muted-foreground text-left"
                    style={{ width: ROOM_COL_W, minWidth: ROOM_COL_W }}
                  >Room</th>
                  {days.map((d, i) => {
                    const isToday = dateKey(d) === todayKey;
                    const isLast = i === days.length - 1;
                    return (
                      <th key={d.toISOString()}
                        className={cn("sticky top-0 z-30 bg-card border-b-2 border-r-2 border-border px-2 py-2 text-[10px] uppercase tracking-wider text-center",
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
                        className="sticky left-0 z-10 bg-card border-b border-r-2 border-border px-2 py-3 text-sm align-middle text-center"
                        style={{ width: ROOM_COL_W, minWidth: ROOM_COL_W }}
                      >
                        <div className="font-medium tabular-nums">{r.room_number}</div>
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
                              {/* Vacant action button — visible when no booking/block covers this day */}
                              {(() => {
                                const coveredByBooking = bs.some((b) => segmentCoversDate(b, dk));
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
                                const endExclusive = slotEndExclusive(b);
                                const endIdx = dayKeys.indexOf(endExclusive);
                                const endCol = endIdx < 0 ? DAY_COUNT : endIdx;
                                const span = Math.max(1, endCol - startCol);
                                if (span <= 0) return null;
                                const cellW = CELL_W_MOB;
                                const hasBreakfast = breakfastByBooking.get(b.id);
                                const balanceDue = (b.status === "Cancelled" || b.status === "No-Show") ? 0 : Math.max(0, Number(b.amount) - Number(b.advance_paid || 0));
                                return (
                                  <button key={`${b.id}-${b._slotKey ?? b.check_in}`} onClick={() => setSelected(b)}
                                    data-booking-pill={b.id}
                                    className={cn(
                                      "absolute top-1.5 bottom-1.5 left-1 rounded-full border-2 px-2 text-[11px] text-left flex items-center gap-1 overflow-hidden hover:ring-2 hover:ring-gold/50 transition shadow-sm",
                                      blockClasses(b.status),
                                      b._virtual && "border-dashed",
                                      highlightId === b.id && "ring-4 ring-gold animate-pulse",
                                    )}
                                    style={{ width: `calc(${span} * ${cellW}px - 8px)`, zIndex: highlightId === b.id ? 10 : 5 }}
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
        hasBreakfast={!!breakfastByBooking.get(selected.id)} businessDate={todayKey} />}
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
              <MetricCard
                label="Guests In-House"
                value={`${adultsInHouse}A, ${childrenInHouse}C`}
                tone="gold"
                sublabel={inHouseRoomNumbers.length > 0 ? `Rooms: ${inHouseRoomNumbers.join(", ")}` : undefined}
              />
              <MetricCard
                label="Breakfast Count"
                value={`${adultsBreakfast}A, ${childrenBreakfast}C`}
                tone="gold"
                icon={<UtensilsCrossed className="h-3.5 w-3.5" />}
                sublabel={breakfastRoomNumbers.length > 0 ? `Rooms: ${breakfastRoomNumbers.join(", ")}` : undefined}
              />
            </div>
          </div>
        </div>
      )}

      {/* Floating action button — quick walk-in booking */}
      <Link
        to="/bookings/new"
        search={{ customerId: undefined, fromQuoteId: undefined } as any}
        title="New Booking"
        aria-label="New Booking"
        className="fixed bottom-6 right-6 z-40 h-14 w-14 rounded-full gold-gradient text-charcoal shadow-lg flex items-center justify-center hover:scale-105 hover:shadow-[0_0_24px_oklch(0.82_0.13_82/0.45)] transition"
      >
        <Plus className="h-6 w-6" />
      </Link>
    </>
  );
}

function Stat({ label, value }: { label: string; value: any }) {
  return <MetricCard label={label} value={value} tone="gold" />;
}
function Legend({ cls, label }: { cls: string; label: string }) {
  return <div className="flex items-center gap-1.5"><span className={cn("inline-block h-3 w-6 rounded-full border-2", cls)} />{label}</div>;
}

function BookingPopover({ b, onClose, rooms, hasBreakfast, businessDate }: { b: any; onClose: () => void; rooms: any[]; hasBreakfast: boolean; businessDate?: string }) {
  const qc = useQueryClient();
  const opsTimes = useOpsTimeLabels();
  const room = rooms.find((r: any) => r.id === b.room_id);
  const { data: chargesForBooking = [] } = useQuery({
    queryKey: ["booking-charges", b.id],
    queryFn: async () => {
      const { listBookingCharges } = await import("@/lib/booking-charges-api");
      return listBookingCharges(b.id);
    },
  });
  const additionalCharges = (chargesForBooking as any[]).reduce((s, c) => s + Number(c.amount || 0), 0);
  const roomCharges = Number(b.amount) || 0;
  const totalCharges = roomCharges + additionalCharges;
  const balance = (b.status === "Cancelled" || b.status === "No-Show") ? 0 : Math.max(0, totalCharges - Number(b.advance_paid || 0));
  const today = businessDate ?? dateKey(new Date());
  const status = b.status as string;
  const [payOpen, setPayOpen] = useState(false);
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [chargeOpen, setChargeOpen] = useState(false);
  const issueToken = useServerFn(issueBookingToken);
  const { values: chargeCategories } = useMasterData("in_house_charge", [
    "Food Order","Water Bottles","Laundry","Dental Kit","Shaving Kit","Coffee","Tea",
    "Late Check-out","Early Check-in","Extra Pet","Extra Adult","Transportation","Other",
  ]);
  const isCheckedOut = status === "Checked-Out" || status === "Stay Completed";
  const canTransact = status !== "Cancelled" && !isCheckedOut;

  const { data: itemsForBooking = [] } = useQuery({
    queryKey: ["booking-items", b.id],
    queryFn: async () => {
      const { listBookingItems } = await import("@/lib/booking-items-api");
      return listBookingItems(b.id);
    },
  });
  const { data: assignmentsForBooking = [] } = useQuery({
    queryKey: ["booking-room-assignments", b.id],
    queryFn: async () => {
      const { listAssignments } = await import("@/lib/booking-room-assignments-api");
      return listAssignments(b.id);
    },
  });
  const { data: paymentsForInvoice = [] } = useQuery({
    queryKey: ["booking-payments", b.id],
    queryFn: () => listBookingPayments(b.id),
    enabled: invoiceOpen,
  });

  const checkIn = useCheckInController({ onCheckedIn: () => onClose() });
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
  const noShowMut = useMutation({
    mutationFn: async () => {
      const { setBookingStatus } = await import("@/lib/bookings-api");
      await setBookingStatus(b.id, "No-Show" as any);
    },
    onSuccess: () => {
      toast.success("Marked as No-Show");
      qc.invalidateQueries({ queryKey: ["bookings"] });
      onClose();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const handleCheckIn = () => checkIn.start(b.id);

  // Dynamic action button:
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
      primary = { label: "Check-In", onClick: handleCheckIn, tone: "green" };
    }
  }

  const toneCls = (t?: string) =>
    t === "green" ? "bg-green-600 text-white hover:bg-green-700" :
    t === "blue" ? "bg-blue-600 text-white hover:bg-blue-700" :
    "gold-gradient text-charcoal";

  const sendWhatsApp = () => {
    if (!b.phone) { toast.error("Customer has no phone number"); return; }
    window.open(bookingWhatsAppLink(b, paymentReminderMessage(b, balance > 0 ? balance : undefined)), "_blank");
  };

  const sharePaymentLink = async () => {
    try {
      const { token } = await issueToken({ data: { booking_id: b.id } });
      const url = `${publicOrigin()}/portal/${token}`;
      const text = [`Hello ${b.guest_name || "Guest"},`, "", "Thank you for choosing Hotel Excella.", "", "To complete your booking, please proceed with the payment here -", "", url, "", `Booking Ref: ${b.booking_reference}`, "", "Regards", "Hotel Excella"].join("\n");
      try { await navigator.clipboard.writeText(url); toast.success("Payment link copied"); } catch { /* noop */ }
      if (b.phone) window.open(bookingWhatsAppLink(b, text), "_blank");
    } catch (e: any) {
      toast.error(e?.message || "Could not generate payment link");
    }
  };

  return (
    <>
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="luxe-card rounded-xl w-full max-w-md p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div>
            <h3 className="font-display text-xl">{b.guest_name}</h3>
            <div className="text-xs text-muted-foreground font-mono">{b.booking_reference}</div>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={sendWhatsApp} disabled={!b.phone} title="WhatsApp" aria-label="WhatsApp"
              className="p-1.5 rounded-md text-green-600 hover:bg-green-600/10 disabled:opacity-40 disabled:pointer-events-none">
              <MessageCircle className="h-4 w-4" />
            </button>
            <button onClick={sharePaymentLink} disabled={balance <= 0 || isCheckedOut} title="Payment Link" aria-label="Payment Link"
              className="p-1.5 rounded-md text-gold hover:bg-gold-soft/40 disabled:opacity-40 disabled:pointer-events-none">
              <Link2 className="h-4 w-4" />
            </button>
            <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <Field label="Room" value={room ? `Room ${room.room_number}` : "Unassigned"} />
          <Field label="Status" value={b.status} />
          <Field label="Check-In" value={`${fmtFull(b.check_in)}, ${opsTimes.checkIn}`} />
          <Field label="Check-Out" value={`${fmtFull(b.check_out)}, ${opsTimes.checkOut}`} />
          <Field label="Guests" value={`${b.adults} Adult${b.adults === 1 ? "" : "s"}${b.children ? ` + ${b.children}` : ""}`} />
          <Field label="Breakfast" value={hasBreakfast ? "Included" : "Not Included"} />
          {(b as any).expected_arrival_at && b.status !== "Checked-In" && b.status !== "Checked-Out" && b.status !== "Stay Completed" && (() => {
            const arr = smartArrival((b as any).expected_arrival_at);
            return arr ? <Field label="Expected Arrival" value={arr.label.replace(/^Arr: /, "")} /> : null;
          })()}
          {b.phone && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Mobile</div>
              <a href={`tel:${b.phone}`} className="text-xs inline-flex items-center gap-1 hover:text-gold">
                <Phone className="h-3 w-3" />{b.phone}
              </a>
            </div>
          )}
        </div>
        {(b as any).special_requests && (
          <div className="rounded-md border border-gold/40 bg-gold-soft/40 px-3 py-2 text-xs">
            <div className="text-[10px] uppercase tracking-wider text-gold mb-1">Special Requests</div>
            <div className="text-foreground whitespace-pre-wrap">{(b as any).special_requests}</div>
          </div>
        )}
        <div className="rounded-md bg-secondary/40 border border-border px-3 py-2 text-xs space-y-1">
          <div className="flex justify-between items-baseline gap-3"><span className="text-muted-foreground">Room Charges</span><Money value={roomCharges} size="sm" /></div>
          {additionalCharges > 0 && (
            <div className="flex justify-between items-baseline gap-3"><span className="text-muted-foreground">Additional Charges</span><Money value={additionalCharges} size="sm" /></div>
          )}
          <div className="flex justify-between items-baseline gap-3"><span className="text-muted-foreground">Total Charges</span><Money value={totalCharges} size="sm" /></div>
          <div className="flex justify-between items-baseline gap-3"><span className="text-muted-foreground">Advance Paid</span><Money value={Number(b.advance_paid || 0)} size="sm" /></div>
          <div className="flex justify-between items-baseline gap-3 border-t border-border/50 pt-1"><span className="font-medium">Balance Due</span><Money value={balance} size="lg" className="gold-text-gradient" /></div>
        </div>
        {canTransact && (
          <div className="grid grid-cols-2 gap-2 pt-1">
            <button onClick={() => setPayOpen(true)}
              className="inline-flex items-center justify-center gap-1.5 rounded-md border border-gold/40 bg-gold-soft/40 text-gold px-3 py-2 text-xs font-medium hover:bg-gold-soft/70">
              <Plus className="h-3 w-3" /> Add Payment
            </button>
            <button onClick={() => setChargeOpen(true)}
              className="inline-flex items-center justify-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-xs font-medium hover:border-gold/40">
              <Plus className="h-3 w-3" /> Add Charge
            </button>
          </div>
        )}
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
              disabled={checkIn.isWorking || checkOutMut.isPending || noShowMut.isPending}
              className={cn("flex-1 text-center rounded-md px-3 py-2 text-xs font-medium disabled:opacity-60", toneCls(primary.tone))}>
              {(checkIn.isWorking || checkOutMut.isPending) ? "Working…" : primary.label}
            </button>
          )}
          {canTransact && status !== "Checked-In" && today > b.check_out && (
            <button
              onClick={() => {
                if (!confirm("Mark this booking as No-Show?")) return;
                noShowMut.mutate();
              }}
              disabled={noShowMut.isPending}
              className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-md border border-destructive/40 bg-destructive/10 text-destructive px-3 py-2 text-xs font-medium hover:bg-destructive/20 disabled:opacity-60">
              {noShowMut.isPending ? "Working…" : "Mark No-Show"}
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
      <InvoiceDialog booking={b} items={itemsForBooking as any} payments={paymentsForInvoice}
        onClose={() => setInvoiceOpen(false)} />
    )}
    <ChargeFormDialog
      key={chargeOpen ? "open" : "closed"}
      open={chargeOpen}
      onOpenChange={setChargeOpen}
      bookingId={b.id}
      categories={chargeCategories}
      editing={null}
    />
    {checkIn.dialogs}
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

function NightAuditPendingBanner({ onOpen, businessDate }: { onOpen: () => void; businessDate?: string }) {
  const { data } = useQuery({
    queryKey: ["night-audit-pending"],
    queryFn: async () => {
      const { getPendingForAudit } = await import("@/lib/night-audit-api");
      return getPendingForAudit();
    },
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  });
  const ciN = data?.pendingCheckIns.length ?? 0;
  const coN = data?.pendingCheckOuts.length ?? 0;
  if (ciN + coN === 0) return null;
  const bdLabel = businessDate ? new Date(businessDate + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : null;
  return (
    <div className="luxe-card rounded-xl p-3 border-warning/40 bg-warning/10 flex items-center justify-between gap-3">
      <div className="flex items-center gap-2 text-warning text-sm">
        <AlertTriangle className="h-4 w-4" />
        <span className="font-medium">Night Audit Pending</span>
        <span className="text-xs text-warning/80">
          {bdLabel ? `· Business Date: ${bdLabel} ` : ""}· Check-Ins: <b className="tabular-nums">{ciN}</b> · Check-Outs: <b className="tabular-nums">{coN}</b>
        </span>
      </div>
      <button onClick={onOpen}
        className="rounded-md gold-gradient px-3 py-1.5 text-xs font-medium text-charcoal">
        Resolve
      </button>
    </div>
  );
}
