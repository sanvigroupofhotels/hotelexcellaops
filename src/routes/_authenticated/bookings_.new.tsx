import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Topbar } from "@/components/topbar";
import { getCustomer, listCustomers } from "@/lib/customers-api";
import { getQuote } from "@/lib/quotes-api";
import { createBooking, type BookingInput } from "@/lib/bookings-api";
import { addBookingItems, quoteItemsToBookingInputs } from "@/lib/booking-items-api";
import { listQuoteItems } from "@/lib/quote-items-api";
import { LineItemsEditor, lineItemsTotal, emptyLine, type LineItem } from "@/components/line-items-editor";
import { BOOKING_STATUSES } from "@/lib/mock-data";
import { NumField } from "@/components/num-field";
import { ArrowLeft, Loader2, BedDouble, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/bookings_/new")({
  validateSearch: (s: Record<string, unknown>) => ({
    customerId: typeof s.customerId === "string" ? s.customerId : undefined,
    fromQuoteId: typeof s.fromQuoteId === "string" ? s.fromQuoteId : undefined,
  }),
  component: NewBooking,
});

const inputCls =
  "w-full bg-input/60 border border-border rounded-md px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gold/40 focus:border-gold/50 transition";

function NewBooking() {
  const navigate = useNavigate();
  const { customerId, fromQuoteId } = Route.useSearch();
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

  const [form, setForm] = useState<BookingInput>({
    customer_id: customerId ?? "",
    source_quote_id: fromQuoteId ?? null,
    guest_name: "", phone: "", email: "",
    check_in: today, check_out: tomorrow,
    adults: 2, children: 0, guests: 2,
    room_details: "", amount: 0, notes: "", internal_notes: "",
    status: "Draft", payment_status: "None",
  });
  const update = <K extends keyof BookingInput>(k: K, v: BookingInput[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  // Booking line items (starts with one primary; extras can be added).
  const [bookingItems, setBookingItems] = useState<LineItem[]>([emptyLine()]);
  const itemsTotal = useMemo(() => lineItemsTotal(bookingItems), [bookingItems]);
  // Keep amount in sync with line items total unless user has overridden.
  useEffect(() => {
    if (bookingItems.length > 0) update("amount", itemsTotal);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemsTotal]);

  // Customer picker (when no customerId passed)
  const { data: customers = [] } = useQuery({ queryKey: ["customers"], queryFn: listCustomers, enabled: !customerId });
  const [pickerQ, setPickerQ] = useState("");
  const matches = useMemo(() => {
    if (!pickerQ) return [] as typeof customers;
    const ql = pickerQ.toLowerCase();
    return customers.filter((c) =>
      c.guest_name.toLowerCase().includes(ql) ||
      (c.phone ?? "").includes(pickerQ) ||
      (c.email ?? "").toLowerCase().includes(ql),
    ).slice(0, 6);
  }, [customers, pickerQ]);

  // Prefill from customer
  const { data: cust } = useQuery({
    queryKey: ["customer", form.customer_id],
    queryFn: () => getCustomer(form.customer_id),
    enabled: !!form.customer_id,
  });
  useEffect(() => {
    if (!cust) return;
    setForm((f) => ({
      ...f,
      guest_name: f.guest_name || cust.guest_name,
      phone: f.phone || cust.phone,
      email: f.email || cust.email,
    }));
  }, [cust]);

  // Prefill from quote
  const { data: quote } = useQuery({
    queryKey: ["quote", fromQuoteId],
    queryFn: () => getQuote(fromQuoteId!),
    enabled: !!fromQuoteId,
  });
  useEffect(() => {
    if (!quote) return;
    setForm((f) => ({
      ...f,
      customer_id: f.customer_id || quote.customer_id || "",
      source_quote_id: quote.id,
      guest_name: quote.guest_name,
      phone: quote.phone,
      email: quote.email ?? "",
      check_in: quote.check_in,
      check_out: quote.check_out,
      adults: (quote as any).adults ?? 2,
      children: (quote as any).children ?? 0,
      guests: (quote as any).guests ?? 2,
      room_details: `${quote.room_type} × ${quote.rooms}`,
      amount: Number(quote.total) || 0,
      notes: quote.special_requests ?? "",
      internal_notes: quote.internal_notes ?? "",
    }));
  }, [quote]);

  const save = useMutation({
    mutationFn: async () => {
      const b = await createBooking(form);
      if (fromQuoteId) {
        // Snapshot quote items
        const items = await listQuoteItems(fromQuoteId);
        if (items.length > 0) await addBookingItems(b.id, quoteItemsToBookingInputs(items));
      } else if (bookingItems.length > 0) {
        // Direct booking: persist its own line items
        await addBookingItems(b.id, bookingItems);
      }
      return b;
    },
    onSuccess: (b) => {
      toast.success(`Booking ${b.booking_reference} created`);
      navigate({ to: "/bookings/$id", params: { id: b.id } });
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <>
      <Topbar title="New Booking" subtitle={fromQuoteId ? "Converting quote to booking" : "Create a direct booking"} />
      <div className="px-4 md:px-8 py-6 md:py-8 max-w-[1000px] space-y-5">
        <Link to="/bookings" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> All bookings
        </Link>

        {!form.customer_id && (
          <section className="luxe-card rounded-xl p-5">
            <h4 className="font-display text-lg mb-3 flex items-center gap-2">
              <Search className="h-4 w-4 text-gold" /> Find Customer
            </h4>
            <input className={inputCls} placeholder="Search by name, phone, or email…"
              value={pickerQ} onChange={(e) => setPickerQ(e.target.value)} />
            {matches.length > 0 && (
              <div className="mt-2 max-h-60 overflow-auto border border-border rounded-md divide-y divide-border/50">
                {matches.map((c) => (
                  <button key={c.id} type="button"
                    onClick={() => { update("customer_id", c.id); setPickerQ(""); }}
                    className="w-full text-left px-3 py-2 hover:bg-secondary/40 text-sm">
                    <div className="font-medium">{c.guest_name}</div>
                    <div className="text-xs text-muted-foreground">{c.phone} · {c.total_quotes} quote{c.total_quotes === 1 ? "" : "s"}</div>
                  </button>
                ))}
              </div>
            )}
            <p className="text-[11px] text-muted-foreground mt-2">
              No matching customer? <Link to="/customers" className="text-gold hover:underline">Create one</Link> first.
            </p>
          </section>
        )}

        {form.customer_id && (
          <>
            {cust && (
              <div className="luxe-card rounded-xl p-4 flex items-center justify-between">
                <div>
                  <div className="text-xs uppercase tracking-wider text-muted-foreground">Customer</div>
                  <div className="font-medium">{cust.guest_name}</div>
                  <div className="text-xs text-muted-foreground">{cust.phone} · {cust.customer_reference}</div>
                </div>
                <button onClick={() => update("customer_id", "")} className="text-xs text-muted-foreground hover:text-foreground">
                  Change
                </button>
              </div>
            )}

            <section className="luxe-card rounded-xl p-5 space-y-4">
              <h4 className="font-display text-lg flex items-center gap-2"><BedDouble className="h-4 w-4 text-gold" /> Booking Details</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Guest Name" required>
                  <input className={inputCls} value={form.guest_name} onChange={(e) => update("guest_name", e.target.value)} />
                </Field>
                <Field label="Phone">
                  <input className={inputCls} value={form.phone ?? ""} onChange={(e) => update("phone", e.target.value)} />
                </Field>
                <Field label="Email">
                  <input className={inputCls} value={form.email ?? ""} onChange={(e) => update("email", e.target.value)} />
                </Field>
                <Field label="Status">
                  <select className={inputCls} value={form.status} onChange={(e) => update("status", e.target.value as any)}>
                    {BOOKING_STATUSES.map((s) => <option key={s}>{s}</option>)}
                  </select>
                </Field>
                <Field label="Check-in" required>
                  <input type="date" className={inputCls} value={form.check_in} onChange={(e) => update("check_in", e.target.value)} />
                </Field>
                <Field label="Check-out" required>
                  <input type="date" className={inputCls} value={form.check_out} onChange={(e) => update("check_out", e.target.value)} />
                </Field>
                <NumField label="Guests" value={form.guests} min={1} onChange={(v) => update("guests", v)} />
                <NumField label="Adults" value={form.adults} min={1} onChange={(v) => update("adults", v)} />
                <NumField label="Children" value={form.children} min={0} onChange={(v) => update("children", v)} />
                <NumField label="Amount (₹)" value={form.amount} min={0} onChange={(v) => update("amount", v)} prefix="₹" />
              </div>
              <Field label="Room Details">
                <input className={inputCls} placeholder="e.g. Oak Room × 1, Deluxe × 2"
                  value={form.room_details ?? ""} onChange={(e) => update("room_details", e.target.value)} />
              </Field>
              <Field label="Notes (visible)">
                <textarea rows={2} className={cn(inputCls, "resize-none")} value={form.notes ?? ""} onChange={(e) => update("notes", e.target.value)} />
              </Field>
              <Field label="Internal Notes (never shared)">
                <textarea rows={2} className={cn(inputCls, "resize-none")} value={form.internal_notes ?? ""} onChange={(e) => update("internal_notes", e.target.value)} />
              </Field>
            </section>

            <button onClick={() => save.mutate()} disabled={save.isPending}
              className="w-full inline-flex items-center justify-center gap-2 rounded-md gold-gradient px-4 py-3 text-sm font-medium text-charcoal hover:shadow-[0_0_24px_oklch(0.82_0.13_82/0.35)] disabled:opacity-60">
              {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Create Booking
            </button>
          </>
        )}
      </div>
    </>
  );
}

function Field({ label, required, children }: any) {
  return (
    <label className="block">
      <span className="block text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">
        {label}{required && <span className="text-gold ml-0.5">*</span>}
      </span>
      {children}
    </label>
  );
}
