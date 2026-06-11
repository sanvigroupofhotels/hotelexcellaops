import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Topbar } from "@/components/topbar";
import { listBookings } from "@/lib/bookings-api";
import { listAllChargeTotals } from "@/lib/booking-charges-api";
import { listCustomers } from "@/lib/customers-api";
import { useRealtimeInvalidate } from "@/hooks/use-realtime";
import { BOOKING_STATUSES, bookingStatusStyles } from "@/lib/mock-data";
import { downloadCSV } from "@/lib/csv";
import { Search, Loader2, Plus, ChevronRight, BedDouble, Phone, MessageCircle, Download } from "lucide-react";
import { cn, toLocalYMD } from "@/lib/utils";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/_authenticated/bookings")({
  component: BookingsPage,
});

function BookingsPage() {
  useRealtimeInvalidate(["bookings", "customers", "booking_charges"], ["bookings", "customers", "all-charge-totals"], "bookings-list");
  const { data: bookings = [], isLoading } = useQuery({ queryKey: ["bookings"], queryFn: listBookings });
  const { data: customers = [] } = useQuery({ queryKey: ["customers"], queryFn: listCustomers });
  const { data: chargeTotals = {} } = useQuery({ queryKey: ["all-charge-totals"], queryFn: listAllChargeTotals });
  const customerById = useMemo(() => Object.fromEntries(customers.map((c) => [c.id, c])), [customers]);

  const [q, setQ] = useState("");
  const [exportOpen, setExportOpen] = useState(false);

  const filtered = useMemo(() => {
    const ql = q.toLowerCase();
    const matched = bookings.filter((b) => {
      if (!q) return true;
      return (
        b.guest_name.toLowerCase().includes(ql) ||
        b.booking_reference.toLowerCase().includes(ql) ||
        (b.phone ?? "").includes(q)
      );
    });
    // Reception ordering: Today's check-ins → Future (asc) → Past (desc)
    const todayStr = toLocalYMD();
    const bucket = (ci: string) => (ci === todayStr ? 0 : ci > todayStr ? 1 : 2);
    return [...matched].sort((a, b) => {
      const ba = bucket(a.check_in); const bb = bucket(b.check_in);
      if (ba !== bb) return ba - bb;
      if (ba === 2) return a.check_in < b.check_in ? 1 : -1; // past: desc
      return a.check_in < b.check_in ? -1 : 1; // today/future: asc
    });
  }, [bookings, q]);

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
          <button onClick={() => setExportOpen(true)} className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-4 py-2 text-sm hover:border-gold/40">
            <Download className="h-4 w-4 text-gold" /> Export
          </button>
          <Link to="/bookings/new" search={{ customerId: undefined, fromQuoteId: undefined } as any}
            className="inline-flex items-center gap-2 rounded-md gold-gradient px-4 py-2 text-sm font-medium text-charcoal hover:shadow-[0_0_18px_oklch(0.82_0.13_82/0.35)]">
            <Plus className="h-4 w-4" /> New Booking
          </Link>
        </div>

        <div className="luxe-card rounded-xl overflow-hidden">
          {isLoading && <div className="p-12 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-gold" /></div>}
          {!isLoading && filtered.length === 0 && (
            <div className="py-16 text-center text-sm text-muted-foreground">
              <BedDouble className="h-8 w-8 text-gold/60 mx-auto mb-3" />
              No bookings found.
            </div>
          )}
          {filtered.map((b, i) => {
            const diff = Number(b.amount) - Number(b.advance_paid || 0);
            const balance = Math.max(0, diff);
            const excess = diff < 0 ? -diff : 0;
            const roomType = (b.room_details || "").split("×")[0]?.trim() || null;
            const guestCount = `${b.adults}A${b.children ? ` + ${b.children}C` : ""}`;
            return (
              <motion.div key={b.id} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.02 }}
                className="px-4 md:px-6 py-4 border-b border-border/60 last:border-0 hover:bg-secondary/40 transition">
                <Link to="/bookings/$id" params={{ id: b.id }} className="block">
                  <div className="grid grid-cols-3 gap-3 items-start">
                    {/* Col 1: Guest Name + Status */}
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{b.guest_name}</div>
                      <div className="mt-1">
                        <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[11px]", bookingStatusStyles[b.status])}>{b.status}</span>
                      </div>
                    </div>

                    {/* Col 2: Dates + Guests + Room Type */}
                    <div className="text-[11px] text-muted-foreground min-w-0">
                      <div className="whitespace-nowrap">
                        {new Date(b.check_in).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })} – {new Date(b.check_out).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
                      </div>
                      <div className="mt-0.5">{b.nights}N · {guestCount}</div>
                      {roomType && <div className="text-gold/80 font-medium mt-0.5 truncate">{roomType}</div>}
                    </div>

                    {/* Col 3: Expected Arrival + Due Amount + Actions */}
                    <div className="flex flex-col items-end gap-1.5">
                      {(b as any).expected_arrival_at && b.status !== "Checked-In" && b.status !== "Checked-Out" && b.status !== "Stay Completed" && (
                        <span className="text-[10px] text-gold/80 font-medium whitespace-nowrap">
                          Arr: {new Date((b as any).expected_arrival_at).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false })}
                        </span>
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
                            <a href={`https://wa.me/${b.phone.replace(/[^0-9]/g, "")}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
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
          })}
        </div>
      </div>
      <ExportBookingsDialog open={exportOpen} onOpenChange={setExportOpen} bookings={bookings} customers={customerById as any} />
    </>
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
