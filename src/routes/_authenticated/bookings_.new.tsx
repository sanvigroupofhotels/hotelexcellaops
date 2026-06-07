import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Topbar } from "@/components/topbar";
import { getCustomer, findCustomerByContact, type CustomerRow } from "@/lib/customers-api";
import { getQuote } from "@/lib/quotes-api";
import { createBooking, type BookingInput } from "@/lib/bookings-api";
import { addBookingItems, quoteItemsToBookingInputs } from "@/lib/booking-items-api";
import { listQuoteItems, rowToLineItem } from "@/lib/quote-items-api";
import { CustomerAutocomplete, ExistingCustomerBanner } from "@/components/customer-lookup";
import {
  lineItemsTotal, lineSubtotal, type LineItem,
} from "@/components/line-items-editor";
import { BOOKING_STATUSES, getRoomRate } from "@/lib/mock-data";
import { NumField } from "@/components/num-field";
import {
  StayFormSections, emptyStayValue, primaryToLineItem, lineItemToPrimary,
  type SharedStayValue,
} from "@/components/shared/stay-form-sections";
import { RoomAssignmentField } from "@/components/room-assignment-field";
import { ArrowLeft, Loader2, BedDouble } from "lucide-react";
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

  // Shared stay sections shape (same as Quote forms).
  const [stay, setStay] = useState<SharedStayValue>(() => emptyStayValue());
  const [extras, setExtras] = useState<LineItem[]>([]);

  // Booking-only fields
  const [status, setStatus] = useState<string>("Pending");
  const [advancePaid, setAdvancePaid] = useState<number>(0);
  const [paymentMethod, setPaymentMethod] = useState<string>("Cash");
  const [linkedCustomerId, setLinkedCustomerId] = useState<string | null>(customerId ?? null);
  const [matchedCustomer, setMatchedCustomer] = useState<CustomerRow | null>(null);
  const [forceNew, setForceNew] = useState(false);

  // Prefill customer (?customerId)
  const { data: cust } = useQuery({
    queryKey: ["customer", linkedCustomerId],
    queryFn: () => getCustomer(linkedCustomerId as string),
    enabled: !!linkedCustomerId,
  });
  useEffect(() => {
    if (!cust) return;
    setStay((s) => ({
      ...s,
      guest_name: s.guest_name || cust.guest_name,
      phone: s.phone || cust.phone || "",
      email: s.email || cust.email || "",
    }));
    setMatchedCustomer(cust);
  }, [cust]);

  // Existing-customer auto-detect by contact
  useEffect(() => {
    if (forceNew || linkedCustomerId) return;
    const phone = stay.phone.trim();
    const email = stay.email.trim();
    const phoneOk = phone.length >= 7;
    const emailOk = !!email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    if (!phoneOk && !emailOk) { setMatchedCustomer(null); return; }
    const t = setTimeout(async () => {
      const c = await findCustomerByContact(phoneOk ? phone : undefined, emailOk ? email : undefined, stay.guest_name);
      if (!c) { setMatchedCustomer(null); return; }
      const exact = phoneOk && c.phone === phone
        && (c.guest_name ?? "").trim().toLowerCase() === stay.guest_name.trim().toLowerCase();
      if (exact) { setLinkedCustomerId(c.id); setMatchedCustomer(null); return; }
      setMatchedCustomer(c);
    }, 400);
    return () => clearTimeout(t);
  }, [stay.phone, stay.email, stay.guest_name, forceNew, linkedCustomerId]);

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
    setLinkedCustomerId((id) => id || quote.customer_id || null);
    setStay((s) => ({
      ...s,
      guest_name: quote.guest_name, phone: quote.phone, email: quote.email ?? "",
      lead_source: quote.lead_source ?? s.lead_source,
      special_requests: quote.special_requests ?? "",
      adults: (quote as any).adults ?? s.adults,
      children: (quote as any).children ?? s.children,
      guests: (quote as any).guests ?? s.guests,
      check_in: quote.check_in, check_out: quote.check_out,
      room_type: quote.room_type, rooms: quote.rooms, extra_bed: quote.extra_bed,
      breakfast_included: quote.breakfast_included ?? true,
      extra_breakfast_guests: quote.extra_breakfast_guests ?? 0,
      early_check_in: quote.early_check_in,
      early_check_in_slot: quote.early_check_in_slot ?? null,
      late_check_out: quote.late_check_out,
      late_check_out_slot: quote.late_check_out_slot ?? null,
      pet_size: (quote as any).pet_size ?? "none",
      pet_charges: quote.pet_charges,
      extra_adults: quote.extra_adults ?? 0,
      drivers: quote.drivers ?? 0,
      discount: Number(quote.discount) || 0,
      internal_notes: quote.internal_notes ?? "",
    }));
  }, [quote]);
  useEffect(() => {
    if (!fromQuoteId || qItems.length === 0) return;
    // Use quote item 0 as primary, rest as extras
    const items = qItems.map(rowToLineItem);
    if (items.length > 0) {
      setStay((s) => ({ ...s, ...lineItemToPrimary(items[0]) } as SharedStayValue));
      setExtras(items.slice(1));
    }
  }, [fromQuoteId, qItems]);

  // Live totals
  const itemsTotal = useMemo(() => {
    const rate = getRoomRate(stay.room_type, stay.breakfast_included);
    return lineSubtotal(primaryToLineItem(stay, rate)) + lineItemsTotal(extras);
  }, [stay, extras]);
  const amount = Math.max(0, itemsTotal - (Number(stay.discount) || 0));
  const balance = Math.max(0, amount - Number(advancePaid || 0));

  const useExistingCustomer = () => {
    if (!matchedCustomer) return;
    setLinkedCustomerId(matchedCustomer.id);
    setStay((s) => ({
      ...s,
      guest_name: matchedCustomer.guest_name,
      phone: matchedCustomer.phone ?? s.phone,
      email: matchedCustomer.email ?? s.email,
    }));
    setForceNew(false);
    toast.success(`Using existing customer: ${matchedCustomer.guest_name}`);
  };

  const save = useMutation({
    mutationFn: async () => {
      const input: BookingInput = {
        customer_id: linkedCustomerId,
        source_quote_id: fromQuoteId ?? null,
        guest_name: stay.guest_name, phone: stay.phone, email: stay.email,
        check_in: stay.check_in, check_out: stay.check_out,
        adults: stay.adults, children: stay.children, guests: stay.guests,
        room_details: `${stay.room_type} × ${stay.rooms}`,
        amount, advance_paid: advancePaid, discount: stay.discount,
        notes: stay.special_requests, internal_notes: stay.internal_notes,
        status: status as any, payment_status: "None",
      };
      const b = await createBooking(input);
      const rate = getRoomRate(stay.room_type, stay.breakfast_included);
      const primary = primaryToLineItem(stay, rate);
      await addBookingItems(b.id, [primary, ...extras]);
      if (fromQuoteId) {
        try {
          const { setStatus: setQuoteStatus } = await import("@/lib/quotes-api");
          await setQuoteStatus(fromQuoteId, "Confirmed");
        } catch {}
      }
      return b;
    },
    onSuccess: async (b) => {
      toast.success(`Booking ${b.booking_reference} created`);
      if (paymentMethod === "Cash" && advancePaid > 0) {
        if (window.confirm(`Cash payment detected.\n\nCreate a Cash Collection entry of ₹${advancePaid.toLocaleString("en-IN")} for this booking?`)) {
          try {
            const { listStaff, createCashTx } = await import("@/lib/cash-api");
            const staff = await listStaff(true);
            if (staff.length === 0) toast.error("No active staff configured. Add staff in Cash Management → Staff Master.");
            else {
              const collector = window.prompt(
                `Collected By? Enter staff name:\n${staff.map(s => `• ${s.name}`).join("\n")}`,
                staff[0].name,
              );
              const chosen = staff.find(s => s.name.toLowerCase() === (collector ?? "").trim().toLowerCase()) ?? staff[0];
              await createCashTx({
                kind: "collection", type_name: "Advance Payment",
                guest_name: b.guest_name, guest_mobile: b.phone, booking_id: b.id,
                staff_id: chosen.id, staff_name: chosen.name,
                amount: advancePaid, notes: `Advance for booking ${b.booking_reference}`,
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

  const customerSlot = (
    <>
      {matchedCustomer && !forceNew && !linkedCustomerId && (
        <div className="mt-4">
          <ExistingCustomerBanner
            customer={matchedCustomer}
            onUseExisting={useExistingCustomer}
            onCreateNew={() => { setForceNew(true); toast.info("Will create a new customer record."); }}
          />
        </div>
      )}
      {linkedCustomerId && cust && (
        <div className="mt-3 rounded-md border border-gold/30 bg-gold-soft/30 px-3 py-2 text-xs flex items-center justify-between">
          <span>Linked to <Link to="/customers/$id" params={{ id: cust.id }} className="text-gold font-medium hover:underline">{cust.guest_name}</Link> <span className="font-mono text-muted-foreground">{cust.customer_reference}</span></span>
          <button onClick={() => { setLinkedCustomerId(null); setMatchedCustomer(null); }} className="text-[10px] uppercase text-muted-foreground hover:text-foreground">Change</button>
        </div>
      )}
      {!linkedCustomerId && !matchedCustomer && (stay.guest_name.trim().length >= 2 || stay.phone.trim().length >= 2) && (
        <div className="mt-3">
          <CustomerAutocomplete
            name={stay.guest_name} phone={stay.phone} email={stay.email}
            onPick={(c) => {
              setLinkedCustomerId(c.id);
              setStay((s) => ({
                ...s, guest_name: c.guest_name,
                phone: c.phone ?? s.phone, email: c.email ?? s.email,
              }));
              setMatchedCustomer(c); setForceNew(false);
            }}
          />
        </div>
      )}
    </>
  );

  return (
    <>
      <Topbar title="New Booking" subtitle={fromQuoteId ? "Converting quote to booking" : "Create a direct booking"} />
      <div className="px-4 md:px-8 py-6 md:py-8 max-w-[1400px] pb-32 lg:pb-8">
        <Link to="/bookings" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-4">
          <ArrowLeft className="h-4 w-4" /> All bookings
        </Link>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
          <div className="space-y-6">
            <StayFormSections
              value={stay} onChange={setStay}
              extras={extras} onExtrasChange={setExtras}
              customerSlot={customerSlot}
              mode="booking"
            />

            {/* Booking-only Payment & Status (below shared sections) */}
            <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
              className="luxe-card rounded-xl p-5 md:p-6 space-y-4">
              <h4 className="font-display text-lg">Booking &amp; Payment</h4>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <label className="block">
                  <span className="block text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">Status</span>
                  <select className={inputCls} value={status} onChange={(e) => setStatus(e.target.value)}>
                    {BOOKING_STATUSES.map((s) => <option key={s}>{s}</option>)}
                  </select>
                </label>
                <div className="rounded-md bg-secondary/40 border border-border px-3 py-2.5">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Total Amount</div>
                  <div className="font-display text-lg gold-text-gradient">₹{amount.toLocaleString("en-IN")}</div>
                </div>
                <NumField label="Advance Paid (₹)" value={advancePaid} min={0} onChange={setAdvancePaid} prefix="₹" />
              </div>
              <label className="block">
                <span className="block text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">Advance Payment Method</span>
                <select className={inputCls} value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
                  <option>Cash</option><option>UPI</option><option>Bank Transfer</option><option>Card</option><option>Other</option>
                </select>
              </label>
              <div className="rounded-md bg-secondary/40 border border-border px-3 py-2.5 flex items-center justify-between">
                <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Balance Payable</span>
                <span className="font-display text-lg gold-text-gradient">₹{balance.toLocaleString("en-IN")}</span>
              </div>
            </motion.section>
          </div>

          <div className="hidden lg:block lg:sticky lg:top-24 self-start space-y-4">
            <div className="luxe-card rounded-xl p-5">
              <h4 className="font-display text-lg mb-3">Booking Summary</h4>
              <SummaryRow label="Items Total" value={itemsTotal} />
              {stay.discount > 0 && <SummaryRow label="Discount" value={-stay.discount} />}
              <SummaryRow label="Total Amount" value={amount} />
              <SummaryRow label="Advance Paid" value={-Number(advancePaid)} mute={!advancePaid} />
              <div className="luxe-divider my-3" />
              <div className="flex items-baseline justify-between">
                <span className="text-sm text-muted-foreground">Balance</span>
                <span className="font-display text-2xl gold-text-gradient">₹{balance.toLocaleString("en-IN")}</span>
              </div>
            </div>
            <button onClick={() => save.mutate()} disabled={save.isPending || !stay.guest_name.trim()}
              className="w-full inline-flex items-center justify-center gap-2 rounded-md gold-gradient px-4 py-3 text-sm font-medium text-charcoal hover:shadow-[0_0_24px_oklch(0.82_0.13_82/0.35)] disabled:opacity-60">
              {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              <BedDouble className="h-4 w-4" /> Create Booking
            </button>
            <p className="text-[10px] text-muted-foreground text-center">Customer is automatically created/linked from phone or email.</p>
          </div>
        </div>

        <div className="lg:hidden fixed bottom-0 inset-x-0 z-40 border-t border-border bg-background/95 backdrop-blur p-3">
          <div className="flex items-center justify-between mb-2 px-1">
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Balance</span>
            <span className="font-display text-lg gold-text-gradient">₹{balance.toLocaleString("en-IN")}</span>
          </div>
          <button onClick={() => save.mutate()} disabled={save.isPending || !stay.guest_name.trim()}
            className="w-full inline-flex items-center justify-center gap-2 rounded-md gold-gradient px-4 py-2.5 text-sm font-medium text-charcoal disabled:opacity-60">
            {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Create Booking
          </button>
        </div>
      </div>
    </>
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
