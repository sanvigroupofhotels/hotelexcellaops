import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Topbar } from "@/components/topbar";
import { getCustomer } from "@/lib/customers-api";
import { getQuote } from "@/lib/quotes-api";
import { createBooking, type BookingInput } from "@/lib/bookings-api";
import { addBookingItems, quoteItemsToBookingInputs } from "@/lib/booking-items-api";
import { listQuoteItems, rowToLineItem } from "@/lib/quote-items-api";
import { CustomerAutocomplete } from "@/components/customer-lookup";
import { LineItemsEditor, lineItemsTotal, emptyLine, type LineItem } from "@/components/line-items-editor";
import { BOOKING_STATUSES } from "@/lib/mock-data";
import { NumField } from "@/components/num-field";
import { ArrowLeft, Loader2, BedDouble, User, Phone, Mail } from "lucide-react";
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
    room_details: "", amount: 0, advance_paid: 0,
    notes: "", internal_notes: "",
    status: "Draft", payment_status: "None",
  });
  const update = <K extends keyof BookingInput>(k: K, v: BookingInput[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  // Line items (primary + extras; uses the same editor as Generate Quote)
  const [bookingItems, setBookingItems] = useState<LineItem[]>([emptyLine()]);
  const itemsTotal = useMemo(() => lineItemsTotal(bookingItems), [bookingItems]);
  useEffect(() => {
    if (bookingItems.length > 0) update("amount", itemsTotal);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemsTotal]);

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

  // Prefill from source quote (Convert to Booking flow)
  const { data: quote } = useQuery({
    queryKey: ["quote", fromQuoteId],
    queryFn: () => getQuote(fromQuoteId!),
    enabled: !!fromQuoteId,
  });
  const { data: qItems = [] } = useQuery({
    queryKey: ["quote-items", fromQuoteId],
    queryFn: () => listQuoteItems(fromQuoteId!),
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
  useEffect(() => {
    if (fromQuoteId && qItems.length > 0) setBookingItems(qItems.map(rowToLineItem));
  }, [fromQuoteId, qItems]);

  const save = useMutation({
    mutationFn: async () => {
      const b = await createBooking(form);
      if (fromQuoteId && qItems.length > 0) {
        await addBookingItems(b.id, quoteItemsToBookingInputs(qItems));
      } else if (bookingItems.length > 0) {
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

  const balance = Math.max(0, Number(form.amount) - Number(form.advance_paid ?? 0));

  return (
    <>
      <Topbar title="New Booking" subtitle={fromQuoteId ? "Converting quote to booking" : "Create a direct booking"} />
      <div className="px-4 md:px-8 py-6 md:py-8 max-w-[1400px] pb-32 lg:pb-8">
        <Link to="/bookings" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-4">
          <ArrowLeft className="h-4 w-4" /> All bookings
        </Link>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
          <div className="space-y-6">
            <section className="luxe-card rounded-xl p-5 md:p-6 space-y-4">
              <h4 className="font-display text-lg">Guest Details</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Guest Name" icon={User} required>
                  <input className={inputCls} value={form.guest_name} onChange={(e) => update("guest_name", e.target.value)} />
                </Field>
                <Field label="Phone" icon={Phone}>
                  <input className={inputCls} value={form.phone ?? ""} onChange={(e) => update("phone", e.target.value)} />
                </Field>
                <Field label="Email" icon={Mail}>
                  <input className={inputCls} value={form.email ?? ""} onChange={(e) => update("email", e.target.value)} />
                </Field>
                <Field label="Status">
                  <select className={inputCls} value={form.status} onChange={(e) => update("status", e.target.value as any)}>
                    {BOOKING_STATUSES.map((s) => <option key={s}>{s}</option>)}
                  </select>
                </Field>
              </div>

              {!form.customer_id && (
                <div>
                  <CustomerAutocomplete
                    name={form.guest_name}
                    phone={form.phone ?? ""}
                    email={form.email ?? ""}
                    onPick={(c) => {
                      setForm((f) => ({
                        ...f,
                        customer_id: c.id,
                        guest_name: c.guest_name,
                        phone: c.phone ?? f.phone,
                        email: c.email ?? f.email,
                      }));
                    }}
                  />
                </div>
              )}
              {cust && (
                <div className="rounded-md border border-gold/30 bg-gold-soft/30 px-3 py-2 text-xs flex items-center justify-between">
                  <span>Linked to <Link to="/customers/$id" params={{ id: cust.id }} className="text-gold font-medium hover:underline">{cust.guest_name}</Link> <span className="font-mono text-muted-foreground">{cust.customer_reference}</span></span>
                  <button onClick={() => update("customer_id", "")} className="text-[10px] uppercase text-muted-foreground hover:text-foreground">Change</button>
                </div>
              )}

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <NumField label="Guests" value={form.guests} min={1} onChange={(v) => update("guests", v)} />
                <NumField label="Adults" value={form.adults} min={1} onChange={(v) => update("adults", v)} />
                <NumField label="Children" value={form.children} min={0} onChange={(v) => update("children", v)} />
              </div>
            </section>

            <section className="luxe-card rounded-xl p-5 md:p-6 space-y-4">
              <h4 className="font-display text-lg flex items-center gap-2"><BedDouble className="h-4 w-4 text-gold" /> Stay Items</h4>
              <LineItemsEditor
                items={bookingItems}
                onChange={setBookingItems}
                title="Rooms / Split Stay"
                hint="Add rooms and stays. Amount auto-syncs with items total."
                startIndex={1}
              />
              <div className="flex items-baseline justify-between border-t border-border pt-3 text-sm">
                <span className="text-muted-foreground">Items Total</span>
                <span className="font-display text-xl gold-text-gradient">₹{itemsTotal.toLocaleString("en-IN")}</span>
              </div>
            </section>

            <section className="luxe-card rounded-xl p-5 md:p-6 space-y-4">
              <h4 className="font-display text-lg">Payment</h4>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <NumField label="Total Amount (₹)" value={form.amount} min={0} onChange={(v) => update("amount", v)} prefix="₹" />
                <NumField label="Advance Paid (₹)" value={form.advance_paid ?? 0} min={0} onChange={(v) => update("advance_paid", v)} prefix="₹" />
                <div className="rounded-md bg-secondary/40 border border-border px-3 py-2.5">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Balance Payable</div>
                  <div className="font-display text-lg gold-text-gradient">₹{balance.toLocaleString("en-IN")}</div>
                </div>
              </div>
              <Field label="Room Details (summary)">
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
          </div>

          <div className="hidden lg:block lg:sticky lg:top-24 self-start space-y-4">
            <div className="luxe-card rounded-xl p-5">
              <h4 className="font-display text-lg mb-3">Booking Summary</h4>
              <SummaryRow label="Items Total" value={itemsTotal} />
              <SummaryRow label="Advance Paid" value={-Number(form.advance_paid ?? 0)} mute={!form.advance_paid} />
              <div className="luxe-divider my-3" />
              <div className="flex items-baseline justify-between">
                <span className="text-sm text-muted-foreground">Balance</span>
                <span className="font-display text-2xl gold-text-gradient">₹{balance.toLocaleString("en-IN")}</span>
              </div>
            </div>
            <button onClick={() => save.mutate()} disabled={save.isPending || !form.guest_name.trim() || !form.customer_id}
              className="w-full inline-flex items-center justify-center gap-2 rounded-md gold-gradient px-4 py-3 text-sm font-medium text-charcoal hover:shadow-[0_0_24px_oklch(0.82_0.13_82/0.35)] disabled:opacity-60">
              {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Create Booking
            </button>
            {!form.customer_id && <p className="text-[11px] text-warning text-center">Pick or create a customer first.</p>}
          </div>
        </div>

        {/* Mobile create button */}
        <div className="lg:hidden fixed bottom-0 inset-x-0 z-40 border-t border-border bg-background/95 backdrop-blur p-3">
          <div className="flex items-center justify-between mb-2 px-1">
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Balance</span>
            <span className="font-display text-lg gold-text-gradient">₹{balance.toLocaleString("en-IN")}</span>
          </div>
          <button onClick={() => save.mutate()} disabled={save.isPending || !form.guest_name.trim() || !form.customer_id}
            className="w-full inline-flex items-center justify-center gap-2 rounded-md gold-gradient px-4 py-2.5 text-sm font-medium text-charcoal disabled:opacity-60">
            {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Create Booking
          </button>
        </div>
      </div>
    </>
  );
}

function Field({ label, icon: Icon, required, children }: any) {
  return (
    <label className="block">
      <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">
        {Icon && <Icon className="h-3 w-3" />}
        {label}{required && <span className="text-gold ml-0.5">*</span>}
      </span>
      {children}
    </label>
  );
}

function SummaryRow({ label, value, mute }: { label: string; value: number; mute?: boolean }) {
  return (
    <div className={cn("flex items-center justify-between py-1.5 text-sm", mute && "text-muted-foreground/60")}>
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("tabular-nums", value < 0 && "text-success")}>
        {value === 0 ? "—" : `${value < 0 ? "-" : ""}₹${Math.abs(value).toLocaleString("en-IN")}`}
      </span>
    </div>
  );
}
