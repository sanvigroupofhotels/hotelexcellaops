import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Topbar } from "@/components/topbar";
import { listBookings } from "@/lib/bookings-api";
import { listCustomers } from "@/lib/customers-api";
import { useRealtimeInvalidate } from "@/hooks/use-realtime";
import { BOOKING_STATUSES, bookingStatusStyles } from "@/lib/mock-data";
import { Search, Loader2, Plus, ChevronRight, BedDouble } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/bookings")({
  component: BookingsPage,
});

function BookingsPage() {
  useRealtimeInvalidate(["bookings", "customers"], ["bookings", "customers"], "bookings-list");
  const { data: bookings = [], isLoading } = useQuery({ queryKey: ["bookings"], queryFn: listBookings });
  const { data: customers = [] } = useQuery({ queryKey: ["customers"], queryFn: listCustomers });
  const customerById = useMemo(() => Object.fromEntries(customers.map((c) => [c.id, c])), [customers]);

  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string>("All");

  const filtered = useMemo(() => bookings.filter((b) => {
    if (status !== "All" && b.status !== status) return false;
    if (!q) return true;
    const ql = q.toLowerCase();
    return (
      b.guest_name.toLowerCase().includes(ql) ||
      b.booking_reference.toLowerCase().includes(ql) ||
      (b.phone ?? "").includes(q)
    );
  }), [bookings, q, status]);

  return (
    <>
      <Topbar title="Bookings" subtitle="Confirmed stays & reservations" />
      <div className="px-4 md:px-8 py-6 md:py-8 space-y-5 max-w-[1400px]">
        <div className="flex flex-col md:flex-row gap-2">
          <div className="flex items-center gap-2 flex-1 px-3 py-2.5 rounded-md bg-card border border-border">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input
              placeholder="Search by name, phone, or booking ref"
              value={q} onChange={(e) => setQ(e.target.value)}
              className="bg-transparent text-sm outline-none flex-1 placeholder:text-muted-foreground/60"
            />
          </div>
          <Link to="/bookings/new" search={{ customerId: undefined, fromQuoteId: undefined } as any}
            className="inline-flex items-center gap-2 rounded-md gold-gradient px-4 py-2 text-sm font-medium text-charcoal hover:shadow-[0_0_18px_oklch(0.82_0.13_82/0.35)]">
            <Plus className="h-4 w-4" /> New Booking
          </Link>
        </div>

        {/* Status tabs */}
        <div className="flex gap-1 overflow-x-auto border-b border-border -mx-4 px-4 md:mx-0 md:px-0">
          {(["All", ...BOOKING_STATUSES] as const).map((s) => {
            const count = s === "All" ? bookings.length : bookings.filter((b) => b.status === s).length;
            return (
              <button key={s} onClick={() => setStatus(s)}
                className={cn(
                  "whitespace-nowrap px-3 py-2 text-xs border-b-2 -mb-px transition",
                  status === s
                    ? "border-gold text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}>
                {s} <span className="ml-1 text-[10px] text-muted-foreground">({count})</span>
              </button>
            );
          })}
        </div>

        <div className="luxe-card rounded-xl overflow-hidden">
          <div className="hidden md:grid grid-cols-12 gap-4 px-6 py-3 text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border bg-secondary/30">
            <div className="col-span-3">Guest</div>
            <div className="col-span-2">Reference</div>
            <div className="col-span-3">Stay</div>
            <div className="col-span-2 text-right">Balance</div>
            <div className="col-span-2">Status</div>
          </div>

          {isLoading && <div className="p-12 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-gold" /></div>}
          {!isLoading && filtered.length === 0 && (
            <div className="py-16 text-center text-sm text-muted-foreground">
              <BedDouble className="h-8 w-8 text-gold/60 mx-auto mb-3" />
              No bookings yet. Create one to get started.
            </div>
          )}
          {filtered.map((b, i) => {
            const c = customerById[b.customer_id];
            const balance = Math.max(0, Number(b.amount) - Number(b.advance_paid || 0));
            return (
              <motion.div key={b.id} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.02 }}>
                <Link to="/bookings/$id" params={{ id: b.id }}
                  className="grid grid-cols-1 md:grid-cols-12 gap-2 md:gap-4 px-4 md:px-6 py-4 border-b border-border/60 last:border-0 hover:bg-secondary/40 transition">
                  <div className="md:col-span-3 min-w-0">
                    <div className="text-sm font-medium">{b.guest_name}</div>
                    {c && <div className="text-[11px] font-mono text-muted-foreground">{c.customer_reference}</div>}
                  </div>
                  <div className="md:col-span-2 text-xs font-mono text-muted-foreground">{b.booking_reference}</div>
                  <div className="md:col-span-3 text-xs">
                    {new Date(b.check_in).toLocaleDateString("en-IN")} – {new Date(b.check_out).toLocaleDateString("en-IN")}
                    <span className="text-muted-foreground ml-1">· {b.nights}N · {b.guests}G</span>
                  </div>
                  <div className="md:col-span-2 text-right text-sm font-medium tabular-nums">
                    {balance > 0 ? (
                      <span className="text-warning">Due ₹{balance.toLocaleString("en-IN")}</span>
                    ) : (
                      <span className="text-success">Paid</span>
                    )}
                  </div>
                  <div className="md:col-span-2 flex items-center justify-between">
                    <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px]",
                      bookingStatusStyles[b.status])}>{b.status}</span>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                </Link>
              </motion.div>
            );
          })}
        </div>
      </div>
    </>
  );
}
