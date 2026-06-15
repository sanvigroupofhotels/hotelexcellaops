import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { Topbar } from "@/components/topbar";
import { listBookings } from "@/lib/bookings-api";
import { listAllChargeTotals } from "@/lib/booking-charges-api";
import { listComplaints } from "@/lib/complaints-api";
import { listCashTx } from "@/lib/cash-api";
import { listRooms } from "@/lib/rooms-api";
import { supabase } from "@/integrations/supabase/client";
import { useRealtimeInvalidate } from "@/hooks/use-realtime";
import { toLocalYMD } from "@/lib/utils";
import { AddBookingPaymentModal } from "@/components/add-booking-payment-modal";
import { ChargeFormDialog } from "@/components/in-house-charges-section";
import { useMasterData } from "@/hooks/use-master-data";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { groupStayAssignments, groupStayItems, pairStaySlotsToRooms, segmentCoversDate } from "@/lib/stay-segments";
import {
  BedDouble, Sunrise, LogIn, IndianRupee, MessageSquareWarning, Brush,
  Plus, Wallet, Tag, Building2, LogOut, FileBarChart,
  TrendingUp, CalendarPlus, PieChart,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/")({
  component: HomePage,
});

function HomePage() {
  useRealtimeInvalidate(
    ["bookings", "complaints", "booking_charges", "booking_payments", "booking_items", "booking_room_assignments", "cash_transactions", "rooms"],
    ["bookings", "complaints", "all-charge-totals", "cash-tx-home", "rooms-home", "booking-items-all-home", "booking-room-assignments-all-home"],
    "home-dashboard",
  );
  const navigate = useNavigate();
  const [roomAction, setRoomAction] = useState<"payment" | "charge" | "checkout" | null>(null);
  const [selectedRoomId, setSelectedRoomId] = useState("");
  const [paymentTarget, setPaymentTarget] = useState<InHouseRoomOption | null>(null);
  const [chargeTarget, setChargeTarget] = useState<InHouseRoomOption | null>(null);
  const { data: bookings = [] } = useQuery({ queryKey: ["bookings"], queryFn: listBookings });
  const { data: chargeTotals = {} } = useQuery({ queryKey: ["all-charge-totals"], queryFn: listAllChargeTotals });
  const { data: complaints = [] } = useQuery({ queryKey: ["complaints"], queryFn: () => listComplaints() });
  const { data: tx = [] } = useQuery({ queryKey: ["cash-tx-home"], queryFn: () => listCashTx({}) });
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
  const arrivalsToday = active.filter((b) => b.check_in === today && b.status !== "Checked-In" && b.status !== "Checked-Out").length;
  const pendingCheckins = active.filter((b) => b.check_in <= today && !["Checked-In","Checked-Out"].includes(b.status as string)).length;
  const dueCollection = active
    .filter((b) => b.status !== "Checked-Out")
    .reduce((sum, b) => {
      const charges = Number((chargeTotals as any)[b.id] ?? 0);
      const due = Math.max(0, Number(b.amount) + charges - Number(b.advance_paid ?? 0));
      return sum + due;
    }, 0);
  const counterCash = tx.reduce((sum, t) => sum + (t.kind === "collection" ? Number(t.amount) : -Number(t.amount)), 0);
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
    { label: "Check-In Guest",     emoji: "🚪", icon: LogIn,               onClick: () => navigate({ to: "/house-view" }) },
    { label: "Check-Out Guest",    emoji: "🚶", icon: LogOut,              onClick: () => setRoomAction("checkout") },
    { label: "Raise Complaint",    emoji: "🛎", icon: MessageSquareWarning,onClick: () => navigate({ to: "/complaints" }) },
    { label: "Reporting",          emoji: "📊", icon: FileBarChart,        onClick: () => navigate({ to: "/reporting" }) },
  ];

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good Morning" : hour < 17 ? "Good Afternoon" : "Good Evening";
  const selectedInHouseRoom = inHouseRooms.find((row) => row.roomId === selectedRoomId) ?? null;

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
              <span className="tabular-nums font-medium">₹{revenueCollectedToday.toLocaleString("en-IN")}</span> Cash Today
            </p>
          </div>
          <Link to="/reporting" className="group inline-flex items-center gap-2 self-start md:self-auto rounded-full gold-gradient px-4 py-2 text-sm font-medium text-charcoal hover:shadow-[0_0_30px_oklch(0.82_0.13_82/0.35)] transition">
            Open Reporting
            <ArrowUpRight className="h-4 w-4 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </Link>
        </motion.section>

        {/* Quick actions */}
        <section>
          <h3 className="font-display text-sm uppercase tracking-[0.2em] text-muted-foreground mb-3">
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
          <h3 className="font-display text-sm uppercase tracking-[0.2em] text-muted-foreground mb-3">
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
    </>
  );
}
