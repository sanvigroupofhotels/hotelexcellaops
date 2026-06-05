import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Topbar } from "@/components/topbar";
import { getCustomer, findCustomerByContact, type CustomerRow } from "@/lib/customers-api";
import { getQuote } from "@/lib/quotes-api";
import { createBooking, type BookingInput } from "@/lib/bookings-api";
import { addBookingItems, quoteItemsToBookingInputs } from "@/lib/booking-items-api";
import { listQuoteItems, rowToLineItem } from "@/lib/quote-items-api";
import { CustomerAutocomplete, ExistingCustomerBanner } from "@/components/customer-lookup";
import { LineItemsEditor, lineItemsTotal, emptyLine, type LineItem } from "@/components/line-items-editor";
import { BOOKING_STATUSES, LEAD_SOURCES } from "@/lib/mock-data";
import { NumField } from "@/components/num-field";
import { ArrowLeft, Loader2, BedDouble, User, Phone, Mail, Users, CalendarDays } from "lucide-react";
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
    customer_id: customerId ?? null,
    source_quote_id: fromQuoteId ?? null,
    guest_name: "", phone: "", email: "",
    check_in: today, check_out: tomorrow,
    adults: 2, children: 0, guests: 2,
    room_details: "", amount: 0, advance_paid: 0,
    notes: "", internal_notes: "",
    status: "Pending", payment_status: "None",
  });
  const [leadSource, setLeadSource] = useState<string>("Direct");
  const [paymentMethod, setPaymentMethod] = useState<string>("Cash");
  const update = <K extends keyof BookingInput>(k: K, v: BookingInput[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  // Line items
  const [bookingItems, setBookingItems] = useState<LineItem[]>([emptyLine()]);
  const itemsTotal = useMemo(() => lineItemsTotal(bookingItems), [bookingItems]);
  useEffect(() => {
    if (bookingItems.length > 0) update("amount", itemsTotal);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemsTotal]);

  // Existing-customer matching (parity with Generate Quote)
  const [matchedCustomer, setMatchedCustomer] = useState<CustomerRow | null>(null);
  const [forceNew, setForceNew] = useState(false);

  // Prefill if ?customerId
  const { data: cust } = useQuery({
    queryKey: ["customer", form.customer_id],
    queryFn: () => getCustomer(form.customer_id as string),
    enabled: !!form.customer_id,
  });
  useEffect(() => {
    if (!cust) return;
    setForm((f) => ({
      ...f,
      guest_name: f.guest_name || cust.guest_name,
      phone: f.phone || cust.phone || "",
      email: f.email || cust.email || "",
    }));
    setMatchedCustomer(cust);
  }, [cust]);

  // Auto-detect existing customer by contact
  useEffect(() => {
    if (forceNew || form.customer_id) return;
    const phone = (form.phone ?? "").trim();
    const email = (form.email ?? "").trim();
    const phoneOk = phone.length >= 7;
    const emailOk = !!email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    if (!phoneOk && !emailOk) { setMatchedCustomer(null); return; }
    const t = setTimeout(async () => {
      const c = await findCustomerByContact(phoneOk ? phone : undefined, emailOk ? email : undefined, form.guest_name);
      if (!c) { setMatchedCustomer(null); return; }
      const exact = phoneOk && c.phone === phone
        && (c.guest_name ?? "").trim().toLowerCase() === (form.guest_name ?? "").trim().toLowerCase();
      if (exact) {
        setForm((f) => ({ ...f, customer_id: c.id }));
        setMatchedCustomer(null);
        return;
      }
      setMatchedCustomer(c);
    }, 400);
    return () => clearTimeout(t);
  }, [form.phone, form.email, form.guest_name, forceNew, form.customer_id]);

  const useExistingCustomer = () => {
    if (!matchedCustomer) return;
    setForm((f) => ({
      ...f,
      customer_id: matchedCustomer.id,
      guest_name: matchedCustomer.guest_name,
      phone: matchedCustomer.phone ?? f.phone,
      email: matchedCustomer.email ?? f.email,
    }));
    setForceNew(false);
    toast.success(`Using existing customer: ${matchedCustomer.guest_name}`);
  };

  // Prefill from source quote (Convert to Booking)
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
      customer_id: f.customer_id || quote.customer_id || null,
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

  const balance = Math.max(0, Number(form.amount) - Number(form.advance_paid ?? 0));

  const save = useMutation({
    mutationFn: async () => {
      const b = await createBooking(form);
      if (fromQuoteId && qItems.length > 0) {
        await addBookingItems(b.id, quoteItemsToBookingInputs(qItems));
        // Mark source quote Confirmed on successful conversion
        try {
          const { setStatus } = await import("@/lib/quotes-api");
          await setStatus(fromQuoteId, "Confirmed");
        } catch {}
      } else if (bookingItems.length > 0) {
        await addBookingItems(b.id, bookingItems);
      }
      return b;
    },
    onSuccess: async (b) => {
      toast.success(`Booking ${b.booking_reference} created`);
      const advance = Number(form.advance_paid ?? 0);
      if (paymentMethod === "Cash" && advance > 0) {
        if (window.confirm(`Cash payment detected.\n\nCreate a Cash Collection entry of ₹${advance.toLocaleString("en-IN")} for this booking?`)) {
          try {
            const { listStaff, createCashTx } = await import("@/lib/cash-api");
            const staff = await listStaff(true);
            if (staff.length === 0) {
              toast.error("No active staff configured. Add staff in Cash Management → Staff Master.");
            } else {
              const collector = window.prompt(
                `Collected By? Enter staff name:\n${staff.map(s => `• ${s.name}`).join("\n")}`,
                staff[0].name,
              );
              const chosen = staff.find(s => s.name.toLowerCase() === (collector ?? "").trim().toLowerCase()) ?? staff[0];
              await createCashTx({
                kind: "collection", type_name: "Advance Payment",
                guest_name: b.guest_name, guest_mobile: b.phone, booking_id: b.id,
                staff_id: chosen.id, staff_name: chosen.name,
                amount: advance, notes: `Advance for booking ${b.booking_reference}`,
              });
              toast.success("Cash collection recorded");
            }
          } catch (e: any) { toast.error(e.message); }
        }
      }
      navigate({ to: "/bookings/$id", params: { id: b.id } });
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <>
      <Topbar title="New Booking" subtitle={fromQuoteId ? "Converting quote to booking" : "Create a direct booking"} />
      <div className="px-4 md:px-8 py-6 md:py-8 max-w-[1400px] pb-32 lg:pb-8">
        <Link to="/bookings" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-4">
          <ArrowLeft className="h-4 w-4" /> All bookings
        </Link>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
          <div className="space-y-6">
            <Card title="Guest Details">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Guest Name" icon={User} required>
                  <input className={inputCls} value={form.guest_name} onChange={(e) => update("guest_name", e.target.value)} />
                </Field>
                <Field label="Phone" icon={Phone} required>
                  <input className={inputCls} placeholder="+91 ..." value={form.phone ?? ""} onChange={(e) => update("phone", e.target.value)} />
                </Field>
              </div>

              {matchedCustomer && !forceNew && !form.customer_id && (
                <div className="mt-4">
                  <ExistingCustomerBanner
                    customer={matchedCustomer}
                    onUseExisting={useExistingCustomer}
                    onCreateNew={() => { setForceNew(true); toast.info("Will create a new customer record."); }}
                  />
                </div>
              )}

              {form.customer_id && cust && (
                <div className="mt-3 rounded-md border border-gold/30 bg-gold-soft/30 px-3 py-2 text-xs flex items-center justify-between">
                  <span>Linked to <Link to="/customers/$id" params={{ id: cust.id }} className="text-gold font-medium hover:underline">{cust.guest_name}</Link> <span className="font-mono text-muted-foreground">{cust.customer_reference}</span></span>
                  <button onClick={() => { update("customer_id", null); setMatchedCustomer(null); }} className="text-[10px] uppercase text-muted-foreground hover:text-foreground">Change</button>
                </div>
              )}

              {!form.customer_id && !matchedCustomer && ((form.guest_name?.trim().length ?? 0) >= 2 || (form.phone?.trim().length ?? 0) >= 2) && (
                <div className="mt-3">
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
                      setMatchedCustomer(c);
                      setForceNew(false);
                    }}
                  />
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
                <Field label="Email" icon={Mail}>
                  <input className={inputCls} value={form.email ?? ""} onChange={(e) => update("email", e.target.value)} />
                </Field>
                <Field label="Lead Source">
                  <select className={inputCls} value={leadSource} onChange={(e) => setLeadSource(e.target.value)}>
                    {LEAD_SOURCES.map((o) => <option key={o}>{o}</option>)}
                  </select>
                </Field>
              </div>

              <div className="mt-5 rounded-lg border border-border bg-secondary/30 p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Users className="h-4 w-4 text-gold" />
                  <span className="text-sm font-medium">Group Size</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <NumField label="# of Guests" value={form.guests} min={1} onChange={(v) => { update("guests", v); if (form.adults > v) update("adults", v); }} />
                  <NumField label="# of Adults" value={form.adults} min={1} onChange={(v) => update("adults", v)} />
                  <NumField label="# of Children" hint="Age below 8 years" value={form.children} min={0} onChange={(v) => update("children", v)} />
                </div>
              </div>
            </Card>

            <Card title="Stay Dates">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Check-in" icon={CalendarDays} required>
                  <input type="date" className={inputCls} value={form.check_in} onChange={(e) => update("check_in", e.target.value)} />
                </Field>
                <Field label="Check-out" icon={CalendarDays} required>
                  <input type="date" className={inputCls} value={form.check_out} onChange={(e) => update("check_out", e.target.value)} />
                </Field>
              </div>
            </Card>

            <Card title="Rooms / Split Stay">
              <LineItemsEditor
                items={bookingItems}
                onChange={setBookingItems}
                title="Rooms / Stay Items"
                hint="Add rooms and stays. Total auto-syncs with items."
                startIndex={1}
              />
              <div className="flex items-baseline justify-between border-t border-border pt-3 mt-3 text-sm">
                <span className="text-muted-foreground">Items Total</span>
                <span className="font-display text-xl gold-text-gradient">₹{itemsTotal.toLocaleString("en-IN")}</span>
              </div>
            </Card>

            <Card title="Booking & Payment">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Field label="Status">
                  <select className={inputCls} value={form.status} onChange={(e) => update("status", e.target.value as any)}>
                    {BOOKING_STATUSES.map((s) => <option key={s}>{s}</option>)}
                  </select>
                </Field>
                <NumField label="Total Amount (₹)" value={form.amount} min={0} onChange={(v) => update("amount", v)} prefix="₹" />
                <NumField label="Advance Paid (₹)" value={form.advance_paid ?? 0} min={0} onChange={(v) => update("advance_paid", v)} prefix="₹" />
              </div>
              <div className="mt-3">
                <Field label="Advance Payment Method">
                  <select className={inputCls} value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
                    <option>Cash</option><option>UPI</option><option>Bank Transfer</option><option>Card</option><option>Other</option>
                  </select>
                </Field>
              </div>
              <div className="mt-3 rounded-md bg-secondary/40 border border-border px-3 py-2.5 flex items-center justify-between">
                <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Balance Payable</span>
                <span className="font-display text-lg gold-text-gradient">₹{balance.toLocaleString("en-IN")}</span>
              </div>
              <Field label="Notes (visible)">
                <textarea rows={2} className={cn(inputCls, "resize-none mt-1")} value={form.notes ?? ""} onChange={(e) => update("notes", e.target.value)} />
              </Field>
              <Field label="Internal Notes (never shared)">
                <textarea rows={2} className={cn(inputCls, "resize-none mt-1")} value={form.internal_notes ?? ""} onChange={(e) => update("internal_notes", e.target.value)} />
              </Field>
            </Card>
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
            <button onClick={() => save.mutate()} disabled={save.isPending || !form.guest_name.trim()}
              className="w-full inline-flex items-center justify-center gap-2 rounded-md gold-gradient px-4 py-3 text-sm font-medium text-charcoal hover:shadow-[0_0_24px_oklch(0.82_0.13_82/0.35)] disabled:opacity-60">
              {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              <BedDouble className="h-4 w-4" /> Create Booking
            </button>
            <p className="text-[10px] text-muted-foreground text-center">Customer is automatically created/linked from phone or email.</p>
          </div>
        </div>

        {/* Mobile sticky create */}
        <div className="lg:hidden fixed bottom-0 inset-x-0 z-40 border-t border-border bg-background/95 backdrop-blur p-3">
          <div className="flex items-center justify-between mb-2 px-1">
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Balance</span>
            <span className="font-display text-lg gold-text-gradient">₹{balance.toLocaleString("en-IN")}</span>
          </div>
          <button onClick={() => save.mutate()} disabled={save.isPending || !form.guest_name.trim()}
            className="w-full inline-flex items-center justify-center gap-2 rounded-md gold-gradient px-4 py-2.5 text-sm font-medium text-charcoal disabled:opacity-60">
            {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Create Booking
          </button>
        </div>
      </div>
    </>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      className="luxe-card rounded-xl p-5 md:p-6">
      <h4 className="font-display text-lg mb-4">{title}</h4>
      {children}
    </motion.section>
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
