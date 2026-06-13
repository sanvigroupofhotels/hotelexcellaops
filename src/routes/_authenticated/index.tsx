import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { Topbar } from "@/components/topbar";
import { listBookings } from "@/lib/bookings-api";
import { listAllChargeTotals } from "@/lib/booking-charges-api";
import { listComplaints } from "@/lib/complaints-api";
import { listCashTx } from "@/lib/cash-api";
import { listRooms } from "@/lib/rooms-api";
import { useRealtimeInvalidate } from "@/hooks/use-realtime";
import { toLocalYMD } from "@/lib/utils";
import {
  BedDouble, Sunrise, LogIn, IndianRupee, MessageSquareWarning, Brush,
  Plus, Wallet, Tag, Building2, LogOut, FileBarChart, ArrowUpRight,
  TrendingUp, CalendarPlus, PieChart,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/")({
  component: HomePage,
});

function HomePage() {
  useRealtimeInvalidate(
    ["bookings", "complaints", "booking_charges", "cash_transactions", "rooms"],
    ["bookings", "complaints", "all-charge-totals", "cash-tx-home", "rooms-home"],
    "home-dashboard",
  );
  const navigate = useNavigate();
  const { data: bookings = [] } = useQuery({ queryKey: ["bookings"], queryFn: listBookings });
  const { data: chargeTotals = {} } = useQuery({ queryKey: ["all-charge-totals"], queryFn: listAllChargeTotals });
  const { data: complaints = [] } = useQuery({ queryKey: ["complaints"], queryFn: () => listComplaints() });
  const { data: tx = [] } = useQuery({ queryKey: ["cash-tx-home"], queryFn: () => listCashTx({}) });
  const { data: rooms = [] } = useQuery({ queryKey: ["rooms-home"], queryFn: listRooms });

  const today = toLocalYMD();
  const todayKey = today;

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
    { label: "Collect Payment",    emoji: "💰", icon: Wallet,              onClick: () => navigate({ to: "/cash", search: { action: "collect" } as any }) },
    { label: "Add In-House Charge",emoji: "🧾", icon: Tag,                 onClick: () => navigate({ to: "/bookings" }) },
    { label: "House View",         emoji: "🏠", icon: Building2,           onClick: () => navigate({ to: "/house-view" }) },
    { label: "Check-In Guest",     emoji: "🚪", icon: LogIn,               onClick: () => navigate({ to: "/bookings" }) },
    { label: "Check-Out Guest",    emoji: "🚶", icon: LogOut,              onClick: () => navigate({ to: "/bookings" }) },
    { label: "Raise Complaint",    emoji: "🛎", icon: MessageSquareWarning,onClick: () => navigate({ to: "/complaints" }) },
    { label: "Reporting",          emoji: "📊", icon: FileBarChart,        onClick: () => navigate({ to: "/reporting" }) },
  ];

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <>
      <Topbar title="Home" subtitle="Operational command centre — today at a glance" />
      <div className="px-4 md:px-8 py-6 md:py-8 space-y-8 max-w-[1400px]">
        <motion.section
          initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
          className="luxe-card rounded-2xl p-6 md:p-8 relative overflow-hidden"
        >
          <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-gold/10 blur-3xl pointer-events-none" />
          <div className="relative flex flex-col md:flex-row md:items-end md:justify-between gap-4">
            <div>
              <p className="text-xs tracking-[0.3em] uppercase text-gold/80">{greeting}</p>
              <h2 className="font-display text-2xl md:text-4xl mt-2">
                Welcome to <span className="gold-text-gradient">Hotel Excella Ops</span>.
              </h2>
              <p className="text-sm text-muted-foreground mt-2 max-w-md">
                {occupied} occupied · {arrivalsToday} arrivals today · {complaintsOpen} open complaints
              </p>
            </div>
            <Link to="/reporting" className="group inline-flex items-center gap-2 self-start md:self-auto rounded-full gold-gradient px-5 py-3 text-sm font-medium text-charcoal hover:shadow-[0_0_30px_oklch(0.82_0.13_82/0.35)] transition">
              Open Reporting
              <ArrowUpRight className="h-4 w-4 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </Link>
          </div>
        </motion.section>

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

        {/* Quick actions */}
        <section>
          <h3 className="font-display text-sm uppercase tracking-[0.2em] text-muted-foreground mb-3">
            Quick Actions
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {quickActions.map((a, i) => (
              <motion.button
                key={a.label}
                initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.03 * i, duration: 0.3 }}
                onClick={a.onClick}
                className="luxe-card rounded-xl p-5 text-left hover:border-gold/40 hover:bg-secondary/40 transition-all flex items-center gap-3"
              >
                <div className="h-10 w-10 rounded-md bg-secondary text-gold flex items-center justify-center text-xl">
                  {a.emoji}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{a.label}</div>
                  <div className="text-[11px] text-muted-foreground">Tap to open</div>
                </div>
              </motion.button>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
