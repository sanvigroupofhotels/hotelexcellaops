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
  type LineItem,
} from "@/components/line-items-editor";
import { computePricing, DEFAULT_TAX_RATE } from "@/lib/pricing";
import { PricingBreakdownCard, StickyPricingFooter } from "@/components/pricing-breakdown";
import { lineSubtotal, nightsOf } from "@/components/line-items-editor";
import { useResolvedRate } from "@/hooks/use-resolved-rate";
import { NumField } from "@/components/num-field";
import {
  StayFormSections, emptyStayValue, primaryToLineItem, lineItemToPrimary,
  type SharedStayValue,
} from "@/components/shared/stay-form-sections";
import { RoomAssignmentField } from "@/components/room-assignment-field";
import { useUserRole } from "@/hooks/use-role";
import { ArrowLeft, Loader2, BedDouble } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/bookings_/new")({
  validateSearch: (s: Record<string, unknown>) => ({
    customerId: typeof s.customerId === "string" ? s.customerId : undefined,
    fromQuoteId: typeof s.fromQuoteId === "string" ? s.fromQuoteId : undefined,
    roomId: typeof s.roomId === "string" ? s.roomId : undefined,
    roomType: typeof s.roomType === "string" ? s.roomType : undefined,
    checkIn: typeof s.checkIn === "string" ? s.checkIn : undefined,
    checkOut: typeof s.checkOut === "string" ? s.checkOut : undefined,
  }),
  component: NewBooking,
});

const inputCls =
  "w-full bg-input/60 border border-border rounded-md px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gold/40 focus:border-gold/50 transition";

function NewBooking() {
  const navigate = useNavigate();
  const { customerId, fromQuoteId, roomId: prefillRoomId, roomType: prefillRoomType, checkIn: prefillIn, checkOut: prefillOut } = Route.useSearch();

  // Shared stay sections shape (same as Quote forms).
  const [stay, setStay] = useState<SharedStayValue>(() => {
    const base = emptyStayValue();
    if (prefillRoomType) base.room_type = prefillRoomType;
    if (prefillIn) base.check_in = prefillIn;
    if (prefillOut) base.check_out = prefillOut;
    return base;
  });
  const [extras, setExtras] = useState<LineItem[]>([]);

  // Booking-only fields. Payment status (Pending/Advance Paid/Full Paid) is auto-derived server-side.
  const [advancePaid, setAdvancePaid] = useState<number>(0);
  const [paymentMethod, setPaymentMethod] = useState<string>("Cash");
  const [roomId, setRoomId] = useState<string | null>(prefillRoomId ?? null);
  const [linkedCustomerId, setLinkedCustomerId] = useState<string | null>(customerId ?? null);
  const [matchedCustomer, setMatchedCustomer] = useState<CustomerRow | null>(null);
  const [forceNew, setForceNew] = useState(false);
  const [totalOverride, setTotalOverride] = useState<number | null>(null);
  const [taxesIncluded, setTaxesIncluded] = useState<boolean>(false);
  const { canManage } = useUserRole();


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

  // P1 SAFETY: if user edits phone after a customer is linked, and the new phone
  // does not match the linked customer's phone, automatically unlink so the booking
  // doesn't get attached to the wrong customer (root cause of the Jayvardhan bug).
  useEffect(() => {
    if (!linkedCustomerId || !cust) return;
    const norm = (s: string | null | undefined) => (s ?? "").replace(/[^0-9]/g, "");
    const formPhone = norm(stay.phone);
    const linkedPhone = norm(cust.phone);
    if (formPhone && linkedPhone && formPhone !== linkedPhone) {
      setLinkedCustomerId(null);
      setMatchedCustomer(null);
      setForceNew(false);
      toast.info("Phone changed — customer link cleared. Re-link or create new on save.");
    }
  }, [stay.phone, cust, linkedCustomerId]);

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

  // Live totals — shared pricing engine (mirrors Quotes 1:1).
  // Rate is now resolved from Rates & Inventory (override → weekend/weekday → default).
  const resolvedRate = useResolvedRate(stay.room_type, stay.check_in, stay.check_out, stay.breakfast_included);
  const { pricing, roomCharges, extraCharges, nights } = useMemo(() => {
    const primary = primaryToLineItem(stay, resolvedRate);
    const all = [primary, ...extras];
    const p = computePricing(all, Number(stay.discount) || 0, DEFAULT_TAX_RATE, { totalOverride, taxesIncluded });
    return {
      pricing: p,
      roomCharges: lineSubtotal(primary),
      extraCharges: extras.reduce((s, i) => s + lineSubtotal(i), 0),
      nights: nightsOf(primary),
    };
  }, [stay, extras, resolvedRate, totalOverride, taxesIncluded]);
  const amount = pricing.total;
  const balance = Math.max(0, amount - Number(advancePaid || 0));


  // Reset the customer link entirely (P3 — Change button reopens search fresh)
  const unlinkCustomer = () => {
    setLinkedCustomerId(null);
    setMatchedCustomer(null);
    setForceNew(false);
    setStay((s) => ({ ...s, guest_name: "", phone: "", email: "" }));
    toast.info("Customer unlinked. Search or create a new customer.");
  };

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
      // P0A FIX: when user explicitly clicks "Create New Customer Anyway",
      // pre-create the customer here so the link_or_create_customer trigger
      // does not silently reuse the existing phone match.
      let effectiveCustomerId: string | null = linkedCustomerId;
      if (!effectiveCustomerId && forceNew) {
        const { createCustomer } = await import("@/lib/customers-api");
        const created = await createCustomer({
          guest_name: stay.guest_name,
          phone: stay.phone || null,
          email: stay.email || null,
          lead_source: stay.lead_source || "Direct",
        });
        effectiveCustomerId = created.id;
        toast.success(`New customer created: ${created.guest_name} (${created.customer_reference})`);
      }
      const input: BookingInput = {
        customer_id: effectiveCustomerId,
        source_quote_id: fromQuoteId ?? null,
        guest_name: stay.guest_name, phone: stay.phone, email: stay.email,
        check_in: stay.check_in, check_out: stay.check_out,
        adults: stay.adults, children: stay.children, guests: stay.guests,
        room_details: `${stay.room_type} × ${stay.rooms}`,
        room_id: roomId,
        amount,
        subtotal: pricing.subtotal,
        taxes: pricing.taxes,
        tax_rate: pricing.taxRate,
        // Don't write advance_paid directly — booking_payments trigger recomputes it.
        advance_paid: advancePaid > 0 ? 0 : 0,
        discount: stay.discount,
        notes: stay.special_requests, internal_notes: stay.internal_notes,
        payment_status: "None",
        lead_source: stay.lead_source || "Direct",
        total_override: totalOverride,
        taxes_included: taxesIncluded,
      };
      const b = await createBooking(input);
      const primary = primaryToLineItem(stay, resolvedRate);
      await addBookingItems(b.id, [primary, ...extras]);

      // If an initial advance was entered, record it as a real booking payment.
      // The DB trigger will (a) recompute b.advance_paid and (b) auto-create a CashBook
      // collection entry when payment_mode = Cash.
      if (advancePaid > 0) {
        try {
          const { createBookingPayment } = await import("@/lib/booking-payments-api");
          const { listStaff } = await import("@/lib/cash-api");
          const staff = await listStaff(true);
          const collectedBy = staff[0]?.name ?? "Front Desk";
          await createBookingPayment({
            booking_id: b.id, customer_id: b.customer_id,
            amount: advancePaid, payment_mode: paymentMethod,
            collected_by: collectedBy,
            notes: `Initial advance · ${b.booking_reference}`,
          });
        } catch (e: any) { toast.error("Booking saved, but advance entry failed: " + e.message); }
      }

      if (fromQuoteId) {
        try {
          const { setStatus: setQuoteStatus } = await import("@/lib/quotes-api");
          await setQuoteStatus(fromQuoteId, "Confirmed");
        } catch {}
      }
      return b;
    },
    onSuccess: (b) => {
      toast.success(`Booking ${b.booking_reference} created`);
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
          <button onClick={unlinkCustomer} className="text-[10px] uppercase text-muted-foreground hover:text-foreground">Change</button>
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
      <div className="px-4 md:px-8 py-6 md:py-8 max-w-[1400px] pb-56 lg:pb-8">
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

            {/* Booking-only Payment (status is auto-derived server-side) */}
            <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
              className="luxe-card rounded-xl p-5 md:p-6 space-y-4">
              <h4 className="font-display text-lg">Booking &amp; Payment</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <NumField
                    label="Total Amount (₹)"
                    value={totalOverride != null ? totalOverride : amount}
                    min={0}
                    onChange={(v) => setTotalOverride(Number(v))}
                    prefix="₹"
                  />
                  <label className="mt-1.5 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer">
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5 accent-gold"
                      checked={taxesIncluded}
                      onChange={(e) => setTaxesIncluded(e.target.checked)}
                    />
                    <span>Taxes Included</span>
                  </label>
                </div>
                <NumField label="Advance Paid (₹)" value={advancePaid} min={0} onChange={setAdvancePaid} prefix="₹" />
              </div>
              <label className="block">
                <span className="block text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">Advance Payment Method</span>
                <select className={inputCls} value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
                  <option>Cash</option><option>UPI</option><option>Bank Transfer</option><option>Card</option><option>Other</option>
                </select>
              </label>
              <RoomAssignmentField
                value={roomId} onChange={setRoomId}
                check_in={stay.check_in} check_out={stay.check_out}
                roomType={stay.room_type}
              />
              <div className="rounded-md bg-secondary/40 border border-border px-3 py-2.5 flex items-center justify-between">
                <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Balance Payable</span>
                <span className="font-display text-lg gold-text-gradient">₹{balance.toLocaleString("en-IN")}</span>
              </div>
            </motion.section>

            {/* Inline breakdown is hidden on mobile — the sticky footer below shows the
                editable breakdown so it's always reachable above the keyboard. */}
          </div>

          <div className="hidden lg:block lg:sticky lg:top-24 self-start space-y-4">
            <PricingBreakdownCard
              roomCharges={roomCharges}
              extraCharges={extraCharges}
              pricing={pricing}
              nights={nights}
              guests={stay.guests}
              editable={true}
              overrideValue={totalOverride}
              onOverrideChange={setTotalOverride}
              onTaxesIncludedChange={setTaxesIncluded}
            />
            {advancePaid > 0 && (
              <div className="luxe-card rounded-xl p-5">
                <SummaryRow label="Advance Paid" value={-Number(advancePaid)} />
                <div className="luxe-divider my-2" />
                <div className="flex items-baseline justify-between">
                  <span className="text-sm text-muted-foreground">Balance</span>
                  <span className="font-display text-2xl gold-text-gradient">₹{balance.toLocaleString("en-IN")}</span>
                </div>
              </div>
            )}
            <button onClick={() => save.mutate()} disabled={save.isPending || !stay.guest_name.trim()}
              className="w-full inline-flex items-center justify-center gap-2 rounded-md gold-gradient px-4 py-3 text-sm font-medium text-charcoal hover:shadow-[0_0_24px_oklch(0.82_0.13_82/0.35)] disabled:opacity-60">
              {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              <BedDouble className="h-4 w-4" /> Create Booking
            </button>
            <p className="text-[10px] text-muted-foreground text-center">Customer is automatically created/linked from phone or email.</p>
          </div>
        </div>

        {/* Sticky footer: editable pricing breakdown + Create Booking — mobile only */}
        <StickyPricingFooter
          pricing={pricing}
          editable={true}
          overrideValue={totalOverride}
          onOverrideChange={setTotalOverride}
          onTaxesIncludedChange={setTaxesIncluded}
          actions={
            <button onClick={() => save.mutate()} disabled={save.isPending || !stay.guest_name.trim()}
              className="w-full inline-flex items-center justify-center gap-2 rounded-md gold-gradient px-4 py-2.5 text-sm font-medium text-charcoal disabled:opacity-60">
              {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Create Booking
            </button>
          }
        />
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
