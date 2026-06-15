import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Topbar } from "@/components/topbar";
import { listBookings, setBookingStatus } from "@/lib/bookings-api";
import { listAllChargeTotals } from "@/lib/booking-charges-api";
import { listComplaints } from "@/lib/complaints-api";
import { getCurrentCashBalance, listCashTx } from "@/lib/cash-api";
import { listRooms } from "@/lib/rooms-api";
import { listBookingItems } from "@/lib/booking-items-api";
import { listAssignments, requiredRoomCount } from "@/lib/booking-room-assignments-api";
import { logBookingActivity } from "@/lib/booking-activities-api";
import { supabase } from "@/integrations/supabase/client";
import { useRealtimeInvalidate } from "@/hooks/use-realtime";
import { toLocalYMD } from "@/lib/utils";
import { buildDailyCashReport, computeOpeningBalance } from "@/lib/cash-report";
import { AddBookingPaymentModal } from "@/components/add-booking-payment-modal";
import { ChargeFormDialog } from "@/components/in-house-charges-section";
import { RoomAssignmentDialog } from "@/components/room-assignment-dialog";
import { useMasterData } from "@/hooks/use-master-data";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { groupStayAssignments, groupStayItems, pairStaySlotsToRooms, segmentCoversDate } from "@/lib/stay-segments";
import {
  BedDouble, Sunrise, LogIn, IndianRupee, MessageSquareWarning, Brush,
  Plus, Wallet, Tag, Building2, LogOut, FileBarChart,
  TrendingUp, CalendarPlus, PieChart, ClipboardCopy, Receipt, Phone,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/")({
  component: HomePage,
});

type InHouseRoomOption = {
  roomId: string;
  roomNumber: string;
  booking: any;
  total: number;
  paid: number;
  due: number;
};

function HomePage() {
  useRealtimeInvalidate(
    ["bookings", "complaints", "booking_charges", "booking_payments", "booking_items", "booking_room_assignments", "cash_transactions", "rooms"],
    ["bookings", "complaints", "all-charge-totals", "cash-tx-home", "cash-current-balance-home", "rooms-home", "booking-items-all-home", "booking-room-assignments-all-home"],
    "home-dashboard",
  );
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [roomAction, setRoomAction] = useState<"payment" | "charge" | "checkout" | null>(null);
  const [selectedRoomId, setSelectedRoomId] = useState("");
  const [paymentTarget, setPaymentTarget] = useState<InHouseRoomOption | null>(null);
  const [chargeTarget, setChargeTarget] = useState<InHouseRoomOption | null>(null);
  const [arrivalsOpen, setArrivalsOpen] = useState(false);
  const [checkInBookingId, setCheckInBookingId] = useState<string | null>(null);
  const { data: bookings = [] } = useQuery({ queryKey: ["bookings"], queryFn: listBookings });
  const { data: chargeTotals = {} } = useQuery({ queryKey: ["all-charge-totals"], queryFn: listAllChargeTotals });
  const { data: complaints = [] } = useQuery({ queryKey: ["complaints"], queryFn: () => listComplaints() });
  const { data: tx = [] } = useQuery({ queryKey: ["cash-tx-home"], queryFn: () => listCashTx({}) });
  const { data: counterCash = 0 } = useQuery({ queryKey: ["cash-current-balance-home"], queryFn: getCurrentCashBalance });
  const { data: rooms = [] } = useQuery({ queryKey: ["rooms-home"], queryFn: () => listRooms() });
  const { values: chargeCategories } = useMasterData("in_house_charge", [
    "Food Order","Water Bottles","Laundry","Dental Kit","Shaving Kit","Coffee","Tea",
    "Late Check-out","Early Check-in","Extra Pet","Extra Adult","Transportation","Other",
  ]);
  const { data: allItems = [] } = useQuery({
    queryKey: ["booking-items-all-home"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("booking_items" as any)
        .select("booking_id,position,room_type,rooms,check_in,check_out");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
  const { data: allAssignments = [] } = useQuery({
    queryKey: ["booking-room-assignments-all-home"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("booking_room_assignments" as any)
        .select("booking_id,room_id,created_at");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const today = toLocalYMD();
  const todayKey = today;
  const itemsByBooking = useMemo(() => groupStayItems(allItems as any[]), [allItems]);
  const assignmentsByBooking = useMemo(() => groupStayAssignments(allAssignments as any[]), [allAssignments]);
  const inHouseRooms = useMemo<InHouseRoomOption[]>(() => {
    return bookings
      .filter((b) => b.status === "Checked-In")
      .flatMap((booking) => {
        const { paired } = pairStaySlotsToRooms(booking as any, itemsByBooking, assignmentsByBooking, rooms as any[]);
        return paired
          .filter(({ slot }) => segmentCoversDate(slot, todayKey))
          .map(({ room_id }) => {
            const room = (rooms as any[]).find((r) => r.id === room_id);
            const charges = Number((chargeTotals as any)[booking.id] ?? 0);
            const total = Number(booking.amount) + charges;
            const paid = Number(booking.advance_paid ?? 0);
            const due = Math.max(0, total - paid);
            return { roomId: room_id, roomNumber: room?.room_number ?? "—", booking, total, paid, due };
          });
      })
      .sort((a, b) => a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true }));
  }, [bookings, itemsByBooking, assignmentsByBooking, rooms, chargeTotals, todayKey]);

  const active = bookings.filter((b) => b.status !== "Cancelled");
  const occupied = active.filter((b) => b.status === "Checked-In").length;
  const arrivalsToday = active.filter((b) => b.check_in === today).length;
  const pendingCheckins = active.filter((b) => b.check_in <= today && !["Checked-In","Checked-Out"].includes(b.status as string)).length;
  const dueCollection = active
    .filter((b) => b.status !== "Checked-Out")
    .reduce((sum, b) => {
      const charges = Number((chargeTotals as any)[b.id] ?? 0);
      const due = Math.max(0, Number(b.amount) + charges - Number(b.advance_paid ?? 0));
      return sum + due;
    }, 0);
  const dueByBooking = new Map<string, number>();
  for (const row of inHouseRooms) if (row.due > 0) dueByBooking.set(row.booking.id, row.due);
  const dueTodayAmount = [...dueByBooking.values()].reduce((sum, due) => sum + due, 0);
  const dueRoomNumbers = inHouseRooms.filter((row) => row.due > 0).map((row) => row.roomNumber);
  const complaintsOpen = complaints.filter((c) => c.status === "Open" || c.status === "In Progress").length;
  const roomsToClean = active.filter((b) => b.status === "Checked-Out" && b.check_out === today).length;

  // New stats
  const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  const revenueCollectedToday = tx
    .filter((t) => t.active && t.kind === "collection" && ymd(new Date(t.occurred_at)) === todayKey)
    .reduce((s, t) => s + Number(t.amount), 0);
  const newBookingsToday = bookings.filter((b) => ymd(new Date(b.created_at)) === todayKey).length;
  const totalRooms = rooms.filter((r: any) => r.active !== false).length;
  const occupancyPct = totalRooms > 0 ? Math.round((occupied / totalRooms) * 100) : 0;

  const stats: Array<{ label: string; value: number | string; icon: any; emoji: string; to: string }> = [
    { label: "Occupied Rooms",   value: occupied,         icon: BedDouble,            emoji: "🏨", to: "/house-view" },
    { label: "Arrivals Today",   value: arrivalsToday,    icon: Sunrise,              emoji: "🟢", to: "/bookings" },
    { label: "Pending Check-ins",value: pendingCheckins,  icon: LogIn,                emoji: "🔴", to: "/bookings" },
    { label: "Due Collection",   value: `₹${dueCollection.toLocaleString("en-IN")}`, icon: IndianRupee, emoji: "💰", to: "/bookings" },
    { label: "Revenue Today",    value: `₹${revenueCollectedToday.toLocaleString("en-IN")}`, icon: TrendingUp, emoji: "📈", to: "/cash" },
    { label: "New Bookings Today", value: newBookingsToday, icon: CalendarPlus,       emoji: "🆕", to: "/bookings" },
    { label: "Occupancy %",      value: `${occupancyPct}%`, icon: PieChart,            emoji: "📊", to: "/house-view" },
    { label: "Complaints Open",  value: complaintsOpen,   icon: MessageSquareWarning, emoji: "🛎", to: "/complaints" },
    { label: "Rooms To Clean",   value: roomsToClean,     icon: Brush,                emoji: "🧹", to: "/house-view" },
  ];

  const quickActions: Array<{ label: string; icon: any; onClick: () => void; emoji: string }> = [
    { label: "New Booking",        emoji: "➕", icon: Plus,                onClick: () => navigate({ to: "/bookings/new" }) },
    { label: "House View",         emoji: "🏠", icon: Building2,           onClick: () => navigate({ to: "/house-view" }) },
    { label: "Collect Payment",    emoji: "💰", icon: Wallet,              onClick: () => setRoomAction("payment") },
    { label: "Add In-House Charge",emoji: "🧾", icon: Tag,                 onClick: () => setRoomAction("charge") },
    { label: "Check-In Guest",     emoji: "🚪", icon: LogIn,               onClick: () => setArrivalsOpen(true) },
    { label: "Check-Out Guest",    emoji: "🚶", icon: LogOut,              onClick: () => setRoomAction("checkout") },
    { label: "Raise Complaint",    emoji: "🛎", icon: MessageSquareWarning,onClick: () => navigate({ to: "/complaints", search: { new: "1" } as any }) },
    { label: "Add Expense",        emoji: "💸", icon: Receipt,             onClick: () => navigate({ to: "/cash", search: { new: "expense" } as any }) },
  ];

  // Today's arrivals — bookings checking in today that aren't yet in-house.
  const todaysArrivals = useMemo(
    () => bookings.filter((b: any) =>
      b.check_in === today && b.status !== "Cancelled" && b.status !== "Checked-In" && b.status !== "Checked-Out" && b.status !== "Stay Completed"
    ),
    [bookings, today],
  );

  const copyTodaysCashReport = async () => {
    try {
      const day = new Date(); day.setHours(0,0,0,0);
      const opening = computeOpeningBalance(tx as any, day);
      const report = buildDailyCashReport(tx as any, day, opening);
      await navigator.clipboard.writeText(report);
      toast.success("Today's cash report copied");
    } catch (e: any) {
      toast.error(e?.message ?? "Could not copy report");
    }
  };

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good Morning" : hour < 17 ? "Good Afternoon" : "Good Evening";

  return (
    <>
      <Topbar title="Home" subtitle="Operational command centre — today at a glance" />
      <div className="px-4 md:px-8 py-6 md:py-8 space-y-6 max-w-[1400px]">
        {/* Compact Welcome Summary */}
        <motion.section
          initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}
          className="luxe-card rounded-2xl px-5 py-4 md:px-6 md:py-5 flex flex-col md:flex-row md:items-center md:justify-between gap-3"
        >
          <div>
            <p className="text-xs tracking-[0.25em] uppercase text-gold/80">{greeting}</p>
            <p className="text-sm md:text-base text-foreground mt-1">
              <span className="tabular-nums font-medium">{occupied}</span> Occupied ·{" "}
              <span className="tabular-nums font-medium">{arrivalsToday}</span> Arrivals Today ·{" "}
              <span className="tabular-nums font-medium">₹{counterCash.toLocaleString("en-IN")}</span> Counter Cash ·{" "}
              <Link to="/dues" search={{ filter: "inhouse" }} className="font-medium hover:text-gold hover:underline">
                <span className="tabular-nums">₹{dueTodayAmount.toLocaleString("en-IN")}</span> Due Today{dueRoomNumbers.length > 0 ? ` (${dueRoomNumbers.join(",")})` : ""}
              </Link>
            </p>
          </div>
        </motion.section>

        {/* Quick actions */}
        <section>
          <h3 className="font-display text-sm uppercase tracking-[0.2em] text-muted-foreground mb-3 text-center">
            Quick Actions
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
            {quickActions.map((a, i) => (
              <motion.button
                key={a.label}
                initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.03 * i, duration: 0.3 }}
                onClick={a.onClick}
                className="luxe-card rounded-xl p-3 text-center hover:border-gold/40 hover:bg-secondary/40 transition-all flex flex-col items-center justify-center gap-1.5 min-h-[96px]"
              >
                <div className="text-2xl leading-none">{a.emoji}</div>
                <div className="text-[12px] sm:text-sm font-medium leading-tight break-words">{a.label}</div>
              </motion.button>
            ))}
          </div>
        </section>

        {/* Stats */}
        <section>
          <h3 className="font-display text-sm uppercase tracking-[0.2em] text-muted-foreground mb-3 text-center">
            Today's Operations
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {stats.map((s, i) => (
              <motion.button
                key={s.label}
                initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.04 * i, duration: 0.3 }}
                onClick={() => navigate({ to: s.to as any })}
                className="luxe-card rounded-xl p-4 text-left hover:border-gold/40 hover:bg-secondary/40 transition-all"
              >
                <div className="flex items-center justify-between">
                  <span className="text-lg leading-none">{s.emoji}</span>
                  <s.icon className="h-4 w-4 text-gold" />
                </div>
                <div className="mt-3 font-display text-2xl text-foreground tabular-nums">{s.value}</div>
                <div className="text-[11px] text-muted-foreground mt-0.5 tracking-wide">{s.label}</div>
              </motion.button>
            ))}
          </div>
        </section>
      </div>

      <RoomActionDialog
        open={!!roomAction}
        action={roomAction}
        rooms={inHouseRooms}
        selectedRoomId={selectedRoomId}
        onSelectedRoomIdChange={setSelectedRoomId}
        onClose={() => { setRoomAction(null); setSelectedRoomId(""); }}
        onContinue={(row) => {
          if (roomAction === "payment") { setPaymentTarget(row); setRoomAction(null); setSelectedRoomId(""); }
          else if (roomAction === "charge") { setChargeTarget(row); setRoomAction(null); setSelectedRoomId(""); }
          else if (roomAction === "checkout") { setRoomAction(null); setSelectedRoomId(""); navigate({ to: "/bookings/$id", params: { id: row.booking.id } }); }
        }}
      />

      {paymentTarget && (
        <AddBookingPaymentModal
          bookingId={paymentTarget.booking.id}
          customerId={paymentTarget.booking.customer_id ?? null}
          maxAmount={paymentTarget.due}
          onClose={() => setPaymentTarget(null)}
          onSaved={() => setPaymentTarget(null)}
        />
      )}

      <ChargeFormDialog
        key={chargeTarget?.booking.id ?? "home-charge-closed"}
        open={!!chargeTarget}
        onOpenChange={(open) => { if (!open) setChargeTarget(null); }}
        bookingId={chargeTarget?.booking.id ?? "00000000-0000-0000-0000-000000000000"}
        categories={chargeCategories}
        editing={null}
      />
    </>
  );
}

function RoomActionDialog({
  open, action, rooms, selectedRoomId, onSelectedRoomIdChange, onClose, onContinue,
}: {
  open: boolean;
  action: "payment" | "charge" | "checkout" | null;
  rooms: InHouseRoomOption[];
  selectedRoomId: string;
  onSelectedRoomIdChange: (value: string) => void;
  onClose: () => void;
  onContinue: (row: InHouseRoomOption) => void;
}) {
  const selected = rooms.find((row) => row.roomId === selectedRoomId) ?? null;
  const title = action === "payment" ? "Collect Payment" : action === "charge" ? "Add In-House Charge" : "Check-Out Guest";

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <label className="block">
            <span className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Room Number *</span>
            <select value={selectedRoomId} onChange={(e) => onSelectedRoomIdChange(e.target.value)}
              className="w-full bg-input/60 border border-border rounded-md px-3 py-2 text-sm">
              <option value="">Select in-house room…</option>
              {rooms.map((row) => (
                <option key={row.roomId} value={row.roomId}>{row.roomNumber} - {row.booking.guest_name}</option>
              ))}
            </select>
          </label>

          {selected ? (
            <div className="rounded-md bg-secondary/40 border border-border px-3 py-2 text-xs space-y-1">
              <div className="flex justify-between"><span className="text-muted-foreground">Guest Name</span><span className="font-medium">{selected.booking.guest_name}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Booking Total</span><span className="tabular-nums">₹{selected.total.toLocaleString("en-IN")}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Paid</span><span className="tabular-nums">₹{selected.paid.toLocaleString("en-IN")}</span></div>
              <div className="flex justify-between border-t border-border/50 pt-1"><span className="font-medium">Due</span><span className="font-display text-base gold-text-gradient">₹{selected.due.toLocaleString("en-IN")}</span></div>
            </div>
          ) : rooms.length === 0 ? (
            <div className="rounded-md border border-border bg-secondary/30 p-3 text-sm text-muted-foreground text-center">No in-house rooms right now.</div>
          ) : null}

          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="rounded-md border border-border bg-card px-3 py-2 text-xs">Cancel</button>
            <button onClick={() => selected && onContinue(selected)} disabled={!selected}
              className="rounded-md gold-gradient px-4 py-2 text-xs font-medium text-charcoal disabled:opacity-50">
              Continue
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
