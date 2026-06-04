import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Topbar } from "@/components/topbar";
import { listBookings, updateBooking } from "@/lib/bookings-api";
import { listBookingItems, replaceBookingItems, quoteItemsToBookingInputs } from "@/lib/booking-items-api";
import { getQuote } from "@/lib/quotes-api";
import { listQuoteItems } from "@/lib/quote-items-api";
import { Loader2, Wrench, Check, X } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/audit")({
  component: AuditPage,
});

const FIELDS = [
  "Customer", "Dates", "Totals", "Notes", "Line Items",
] as const;

function AuditPage() {
  const qc = useQueryClient();
  const { data: bookings = [], isLoading } = useQuery({ queryKey: ["bookings"], queryFn: listBookings });
  const converted = bookings.filter((b: any) => b.source_quote_id);

  return (
    <>
      <Topbar title="Consistency Audit" subtitle="Quote → Booking field parity" />
      <div className="px-4 md:px-8 py-6 md:py-8 max-w-[1400px] space-y-4">
        <div className="luxe-card rounded-xl p-5 text-sm text-muted-foreground">
          Validates each booking that was converted from a quote. Fix Mismatch resyncs line items and totals from the source quote. Only enabled when status is not <em className="text-foreground">Stay Completed</em>.
        </div>
        {isLoading && <div className="p-12 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-gold" /></div>}
        {!isLoading && converted.length === 0 && (
          <div className="luxe-card rounded-xl p-12 text-center text-sm text-muted-foreground">No converted bookings to audit yet.</div>
        )}
        <div className="space-y-3">
          {converted.map((b: any) => (
            <AuditRow key={b.id} booking={b} onFixed={() => qc.invalidateQueries({ queryKey: ["bookings"] })} />
          ))}
        </div>
      </div>
    </>
  );
}

function AuditRow({ booking, onFixed }: { booking: any; onFixed: () => void }) {
  const { data: quote } = useQuery({
    queryKey: ["quote", booking.source_quote_id], queryFn: () => getQuote(booking.source_quote_id),
  });
  const { data: qItems = [] } = useQuery({
    queryKey: ["quote-items", booking.source_quote_id], queryFn: () => listQuoteItems(booking.source_quote_id),
    enabled: !!booking.source_quote_id,
  });
  const { data: bItems = [] } = useQuery({
    queryKey: ["booking-items", booking.id], queryFn: () => listBookingItems(booking.id),
  });

  const fix = useMutation({
    mutationFn: async () => {
      if (!quote) return;
      await updateBooking(booking.id, {
        guest_name: quote.guest_name,
        phone: quote.phone, email: quote.email ?? "",
        check_in: quote.check_in, check_out: quote.check_out,
        amount: Number(quote.total) || 0,
        notes: quote.special_requests ?? "",
      });
      await replaceBookingItems(booking.id, quoteItemsToBookingInputs(qItems as any));
    },
    onSuccess: () => { toast.success(`Booking ${booking.booking_reference} synced from quote`); onFixed(); },
    onError: (e: any) => toast.error(e.message),
  });

  if (!quote) {
    return (
      <div className="luxe-card rounded-xl p-4 text-sm flex items-center gap-3">
        <Loader2 className="h-4 w-4 animate-spin text-gold" /> Loading {booking.booking_reference}…
      </div>
    );
  }

  const checks: Record<string, boolean> = {
    Customer: booking.customer_id === quote.customer_id && booking.guest_name === quote.guest_name,
    "Lead Source": (quote.lead_source ?? "") === (booking.lead_source ?? quote.lead_source ?? ""),
    Dates: booking.check_in === quote.check_in && booking.check_out === quote.check_out,
    Totals: Math.round(Number(booking.amount)) === Math.round(Number(quote.total)),
    Notes: (booking.notes ?? "") === (quote.special_requests ?? ""),
    "Line Items": bItems.length === qItems.length &&
      bItems.every((bi: any, i: number) => {
        const qi: any = qItems[i];
        return qi && bi.room_type === qi.room_type && bi.check_in === qi.check_in && bi.check_out === qi.check_out
          && bi.adults === qi.adults && bi.children === qi.children
          && Math.round(Number(bi.subtotal)) === Math.round(Number(qi.subtotal));
      }),
  };
  const allOk = FIELDS.every((f) => checks[f]);
  const canFix = booking.status !== "Stay Completed";

  return (
    <div className="luxe-card rounded-xl p-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <Link to="/bookings/$id" params={{ id: booking.id }} className="font-mono text-sm text-gold hover:underline">
            {booking.booking_reference}
          </Link>
          <span className="text-xs text-muted-foreground"> · {booking.guest_name} · {booking.status}</span>
          <div className="text-[11px] text-muted-foreground mt-0.5">
            Source quote: <Link to="/quote/$id" params={{ id: quote.id }} className="hover:text-gold font-mono">{quote.reference_code}</Link>
          </div>
        </div>
        {allOk ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-success/15 text-success border border-success/40 px-3 py-1 text-xs">
            <Check className="h-3 w-3" /> All in sync
          </span>
        ) : (
          <button onClick={() => fix.mutate()} disabled={!canFix || fix.isPending}
            className="inline-flex items-center gap-1.5 rounded-md gold-gradient px-3 py-1.5 text-xs font-medium text-charcoal disabled:opacity-50 disabled:cursor-not-allowed"
            title={canFix ? "Resync booking from source quote" : "Cannot fix — booking is Stay Completed"}>
            {fix.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wrench className="h-3 w-3" />} Fix Mismatch
          </button>
        )}
      </div>
      <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
        {FIELDS.map((f) => (
          <div key={f} className="flex items-center gap-1.5 text-xs">
            {checks[f] ? <Check className="h-3.5 w-3.5 text-success" /> : <X className="h-3.5 w-3.5 text-destructive" />}
            <span className={checks[f] ? "text-foreground" : "text-destructive"}>{f}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
