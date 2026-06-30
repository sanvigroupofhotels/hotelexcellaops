/**
 * Quick Booking Form — speed-optimized Reception flow.
 *
 * This screen is intentionally NOT a second implementation of the booking
 * pipeline. It's the second consumer of the shared services that the
 * Detailed Booking Form (`bookings_.new.tsx`) also calls:
 *
 *   • Pricing        → `@/lib/pricing` (`computePricing`)
 *   • Inventory      → `@/lib/room-inventory` (`useRoomTypeAvailability`,
 *                                              `maxSelectableRooms`)
 *   • Rate resolution→ `@/hooks/use-resolved-rate`
 *   • Customer       → `@/components/customer-lookup` autocomplete + banner
 *   • Creation       → `@/lib/booking-create` (`submitNewBooking`)
 *                       which wraps createBooking + items + advance payment
 *                       + notifications + DB-side activity triggers.
 *   • Charges dialog → `@/components/in-house-charges-section` (ChargeFormDialog)
 *   • Payment dialog → `@/components/add-booking-payment-modal`
 *
 * The form supports two flows:
 *   1. Create-and-go: fill fields → Create Booking → land on detail page.
 *   2. Stage charges/payments inline: pressing "Add Charges" or "Add Payment"
 *      auto-creates the booking first (validating identical rules), then
 *      opens the existing dialog against the new booking id.
 */
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Topbar } from "@/components/topbar";
import { Loader2, Plus, Minus, Sparkles, Star, UserCheck } from "lucide-react";
import { toast } from "sonner";

import { findCustomerByContact, type CustomerRow } from "@/lib/customers-api";
import { normalizePhoneNumber, validatePhoneNumber } from "@/lib/phone";
import { computePricing, DEFAULT_TAX_RATE } from "@/lib/pricing";
import { PricingBreakdownCard } from "@/components/pricing-breakdown";
import { type LineItem, nightsOf } from "@/components/line-items-editor";
import { useResolvedRate } from "@/hooks/use-resolved-rate";
import { useRoomTypeAvailability, maxSelectableRooms } from "@/lib/room-inventory";
import { submitNewBooking } from "@/lib/booking-create";
import { type BookingInput } from "@/lib/bookings-api";
import { getPaymentSettings, DEFAULT_PAYMENT_SETTINGS } from "@/lib/app-settings-api";
import { toLocalYMD, localYMDOffset, cn } from "@/lib/utils";
import { ChargeFormDialog } from "@/components/in-house-charges-section";
import { AddBookingPaymentModal } from "@/components/add-booking-payment-modal";
import { NumField } from "@/components/num-field";
import { useMasterData } from "@/hooks/use-master-data";

export const Route = createFileRoute("/_authenticated/bookings_/quick")({
  component: QuickBookingPage,
});

const PAYMENT_MODES = ["Cash", "UPI", "Card", "Bank Transfer", "Other"];

function makeRoomLine(room_type: string, rooms: number, adults: number, children: number, check_in: string, check_out: string, rate: number): LineItem {
  return {
    room_type, rooms, adults, children, check_in, check_out,
    breakfast_included: false, extra_bed: 0, rate,
    early_check_in: false, early_check_in_slot: null,
    late_check_out: false, late_check_out_slot: null,
    pet_size: "none", extra_adults: 0, drivers: 0,
  };
}

function QuickBookingPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();

  // ---- Stay basics (one set of dates for the whole stay) ----
  const [checkIn, setCheckIn] = useState(toLocalYMD());
  const [checkOut, setCheckOut] = useState(localYMDOffset(1));
  const nights = Math.max(1, nightsOf({ check_in: checkIn, check_out: checkOut }));

  // ---- Guest ----
  const [guestName, setGuestName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [linkedCustomer, setLinkedCustomer] = useState<CustomerRow | null>(null);

  // Normalize once — single source of truth for validation, lookup, and save.
  const normalizedPhone = useMemo(() => normalizePhoneNumber(phone), [phone]);
  const phoneValid = validatePhoneNumber(normalizedPhone);

  // ---- Occupancy & rooms ----
  const [adults, setAdults] = useState(2);
  const [kids, setKids] = useState(0);
  const [oakRooms, setOakRooms] = useState(1);
  const [mappleRooms, setMappleRooms] = useState(0);

  // ---- Pricing override / discount / other charges ----
  const [otherCharges, setOtherCharges] = useState(0);
  const [otherDescription, setOtherDescription] = useState("");
  const [discount, setDiscount] = useState(0);
  const [totalOverride, setTotalOverride] = useState<string>("");
  const [taxesIncluded] = useState(true); // override entered as gross by default (Reception expectation)

  // ---- Auto-focus mobile field on mount for speed ----
  const phoneRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => { phoneRef.current?.focus(); }, []);

  // ---- Existing customer match — phone is the unique identifier. ----
  // Lookup ONLY by normalized phone; guest name never drives the search.
  const { data: matchedCustomer } = useQuery({
    queryKey: ["customer-match-phone", normalizedPhone],
    queryFn: () => findCustomerByContact(normalizedPhone, undefined, undefined),
    enabled: phoneValid,
    staleTime: 30_000,
  });
  useEffect(() => {
    if (matchedCustomer) {
      setLinkedCustomer(matchedCustomer);
      // Auto-populate name/email if the form is still empty.
      setGuestName((g) => g.trim() ? g : (matchedCustomer.guest_name ?? ""));
      setEmail((e) => e.trim() ? e : (matchedCustomer.email ?? ""));
    } else {
      setLinkedCustomer(null);
    }
  }, [matchedCustomer]); // eslint-disable-line

  // ---- Rate resolution (same hook as Detailed form) ----
  const oakRate = useResolvedRate("Oak Room", checkIn, checkOut, false);
  const mappleRate = useResolvedRate("Mapple Room", checkIn, checkOut, false);

  // ---- Inventory (same hook + helper as Detailed form) ----
  const { data: availability } = useRoomTypeAvailability(checkIn, checkOut);
  const oakInv = maxSelectableRooms(availability, "Oak Room", oakRooms);
  const mappleInv = maxSelectableRooms(availability, "Mapple Room", mappleRooms);

  // Clamp room counts to inventory (single guard rail — UI prevents in the steppers too).
  useEffect(() => {
    if (oakRooms > oakInv.max) setOakRooms(Math.max(0, oakInv.max));
  }, [oakInv.max]); // eslint-disable-line
  useEffect(() => {
    if (mappleRooms > mappleInv.max) setMappleRooms(Math.max(0, mappleInv.max));
  }, [mappleInv.max]); // eslint-disable-line

  // ---- Line items (rooms only — Other Charges is persisted via booking_charges) ----
  const items = useMemo(() => {
    const totalRooms = Math.max(1, oakRooms + mappleRooms);
    const adultsPerRoom = Math.max(1, Math.ceil(adults / totalRooms));
    const kidsPerRoom = Math.ceil(kids / totalRooms);
    const out: LineItem[] = [];
    if (oakRooms > 0) out.push(makeRoomLine("Oak Room", oakRooms, adultsPerRoom * oakRooms, kidsPerRoom * oakRooms, checkIn, checkOut, oakRate));
    if (mappleRooms > 0) out.push(makeRoomLine("Mapple Room", mappleRooms, adultsPerRoom * mappleRooms, kidsPerRoom * mappleRooms, checkIn, checkOut, mappleRate));
    return out;
  }, [oakRooms, mappleRooms, adults, kids, checkIn, checkOut, oakRate, mappleRate]);

  // ---- Other Charges modelled as a synthetic LineItem so it flows through the
  // shared pricing engine (taxable + GST + override math). Stripped from
  // persisted booking_items; recorded as a booking_charges row instead. ----
  const pricingItems = useMemo(() => {
    if (!(otherCharges > 0)) return items;
    const n = Math.max(1, nights);
    const synthetic: LineItem = {
      room_type: "Other Charges",
      rooms: 1, adults: 0, children: 0,
      check_in: checkIn, check_out: checkOut,
      breakfast_included: false, extra_bed: 0,
      rate: otherCharges / n,
      early_check_in: false, early_check_in_slot: null,
      late_check_out: false, late_check_out_slot: null,
      pet_size: "none", extra_adults: 0, drivers: 0,
    };
    return [...items, synthetic];
  }, [items, otherCharges, nights, checkIn, checkOut]);

  const overrideNum = totalOverride.trim() === "" ? null : Number(totalOverride);
  const pricing = computePricing(pricingItems, discount, DEFAULT_TAX_RATE, {
    totalOverride: overrideNum,
    taxesIncluded,
  });

  // ---- Advance payment captured inline (stored via createBookingPayment) ----
  const [advanceAmount, setAdvanceAmount] = useState(0);
  const [paymentMode, setPaymentMode] = useState("Cash");

  // ---- Validation guard rails ----
  const errors = useMemo(() => {
    const e: string[] = [];
    if (!guestName.trim()) e.push("Guest name is required");
    if (!/^[6-9]\d{9}$/.test(phone.trim())) e.push("Enter a valid 10-digit Indian mobile number");
    if (!checkIn || !checkOut || checkOut <= checkIn) e.push("Check-out must be after Check-in");
    if (oakRooms + mappleRooms < 1) e.push("Select at least one room");
    if (oakRooms > oakInv.max || mappleRooms > mappleInv.max) e.push("Room count exceeds available inventory");
    if (adults < 1) e.push("At least one adult required");
    return e;
  }, [guestName, phone, checkIn, checkOut, oakRooms, mappleRooms, oakInv.max, mappleInv.max, adults]);

  // ---- Booking creation (shared submitNewBooking helper) ----
  const [createdBookingId, setCreatedBookingId] = useState<string | null>(null);
  const [createdCustomerId, setCreatedCustomerId] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async () => {
      if (errors.length > 0) throw new Error(errors[0]);
      const settings = await getPaymentSettings().catch(() => DEFAULT_PAYMENT_SETTINGS);
      const totalRooms = oakRooms + mappleRooms;
      const roomDetails = [
        oakRooms > 0 ? `Oak × ${oakRooms}` : null,
        mappleRooms > 0 ? `Mapple × ${mappleRooms}` : null,
      ].filter(Boolean).join(", ");

      const booking: Omit<BookingInput, "customer_id"> = {
        source_quote_id: null,
        guest_name: guestName.trim(),
        phone: phone.trim(),
        email: email.trim() || null,
        check_in: checkIn,
        check_out: checkOut,
        adults, children: kids,
        guests: adults + kids,
        room_details: roomDetails,
        room_id: null,
        amount: pricing.total,
        subtotal: pricing.subtotal,
        taxes: pricing.taxes,
        tax_rate: pricing.taxRate,
        discount: pricing.discount,
        notes: null,
        internal_notes: null,
        payment_status: "None",
        lead_source: "Direct",
        total_override: overrideNum,
        taxes_included: taxesIncluded,
        allow_full_payment: settings.allow_full_payment,
        allow_part_payment: settings.allow_part_payment,
        allow_pay_at_hotel: settings.allow_pay_at_hotel,
        part_payment_type: "percent",
        part_payment_value: settings.default_part_percent,
      };

      const { booking: created, createdCustomerId: newCustId } = await submitNewBooking({
        linkedCustomerId: linkedCustomer?.id ?? null,
        forceNew,
        booking,
        items, // rooms only — Other Charges is NOT in booking_items
        advance: advanceAmount > 0 ? { amount: advanceAmount, payment_mode: paymentMode } : undefined,
      });

      // Persist Other Charges via the existing charge pipeline.
      if (otherCharges > 0) {
        const { createBookingCharge } = await import("@/lib/booking-charges-api");
        await createBookingCharge({
          booking_id: created.id,
          category: "Other",
          other_description: otherDescription.trim() || "Quick Booking — other charges",
          quantity: 1,
          unit_price: otherCharges,
          notes: "Captured via Quick Booking",
        });
      }

      if (newCustId) toast.success(`New customer created for ${created.guest_name}`);
      void totalRooms;
      return created;
    },
    onSuccess: (b) => {
      qc.invalidateQueries({ queryKey: ["bookings"] });
      setCreatedBookingId(b.id);
      setCreatedCustomerId(b.customer_id);
      toast.success(`Booking ${b.booking_reference} created`);
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not create booking"),
  });

  // After creation, allow Reception to keep adding charges/payments OR jump to detail.
  const [chargeOpen, setChargeOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);

  // Charge categories — same master-data source the InHouseChargesSection uses.
  const { values: chargeCategories } = useMasterData("in_house_charge", [
    "Food & Beverage", "Laundry", "Mini Bar", "Spa", "Transport", "Other",
  ]);

  async function ensureBookingThen(open: (id: string) => void) {
    if (createdBookingId) { open(createdBookingId); return; }
    if (errors.length > 0) { toast.error(errors[0]); return; }
    const b = await save.mutateAsync().catch(() => null);
    if (b?.id) open(b.id);
  }

  const stepCls = "flex items-center justify-center h-9 w-9 rounded-md border border-border bg-card hover:bg-secondary disabled:opacity-40 disabled:cursor-not-allowed";

  return (
    <div className="min-h-screen bg-background">
      <Topbar title="Quick Booking" subtitle="Fast Reception flow · shared pricing & inventory" />
      <div className="mx-auto max-w-2xl px-3 py-4 space-y-4 pb-32">

        {/* GROUP 1 — Stay dates (most-changed field, kept at top) */}
        <section className="luxe-card rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-gold">
            <Sparkles className="h-3.5 w-3.5" /> Stay
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Check-in">
              <input type="date" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} className="qb-input" />
            </Field>
            <Field label="Check-out">
              <input type="date" value={checkOut} min={checkIn} onChange={(e) => setCheckOut(e.target.value)} className="qb-input" />
            </Field>
          </div>
          <div className="text-xs text-muted-foreground">
            {nights} night{nights === 1 ? "" : "s"}
          </div>
        </section>

        {/* GROUP 2 — Guest details */}
        <section className="luxe-card rounded-xl p-4 space-y-3">
          <div className="text-xs uppercase tracking-wider text-gold">Guest</div>
          <Field label="Guest name *">
            <input ref={nameRef} value={guestName} onChange={(e) => setGuestName(e.target.value)} placeholder="Full name" className="qb-input" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Mobile *">
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/[^0-9]/g, "").slice(0, 10))}
                placeholder="10-digit"
                inputMode="tel"
                className="qb-input"
              />
            </Field>
            <Field label="Email (optional)">
              <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="guest@example.com" inputMode="email" className="qb-input" />
            </Field>
          </div>
          <CustomerAutocomplete
            name={guestName}
            phone={phone}
            email={email}
            onPick={(c) => { setLinkedCustomer(c); setGuestName(c.guest_name); setPhone(c.phone ?? ""); setEmail(c.email ?? ""); setForceNew(false); }}
          />
          {linkedCustomer && (
            <ExistingCustomerBanner
              customer={linkedCustomer}
              onUseExisting={() => { /* already linked — no-op */ }}
              onCreateNew={() => { setLinkedCustomer(null); setForceNew(true); toast.message("Will create a new customer record on save"); }}
            />
          )}
        </section>

        {/* GROUP 3 — Occupancy + Rooms (kept side-by-side to reduce scroll) */}
        <section className="luxe-card rounded-xl p-4 space-y-3">
          <div className="text-xs uppercase tracking-wider text-gold">Occupancy & Rooms</div>
          <div className="grid grid-cols-2 gap-3">
            <Stepper label="Adults" value={adults} min={1} max={20} onChange={setAdults} cls={stepCls} />
            <Stepper label="Kids" value={kids} min={0} max={20} onChange={setKids} cls={stepCls} />
          </div>
          <div className="grid grid-cols-2 gap-3 pt-1">
            <div>
              <Stepper label="Oak Rooms" value={oakRooms} min={0} max={oakInv.max} onChange={setOakRooms} cls={stepCls} />
              <div className={cn("text-[11px] mt-1", oakInv.available <= 0 ? "text-destructive" : "text-muted-foreground")}>{oakInv.label}</div>
            </div>
            <div>
              <Stepper label="Mapple Rooms" value={mappleRooms} min={0} max={mappleInv.max} onChange={setMappleRooms} cls={stepCls} />
              <div className={cn("text-[11px] mt-1", mappleInv.available <= 0 ? "text-destructive" : "text-muted-foreground")}>{mappleInv.label}</div>
            </div>
          </div>
        </section>

        {/* GROUP 4 — Other Charges + discount + override */}
        <section className="luxe-card rounded-xl p-4 space-y-3">
          <div className="text-xs uppercase tracking-wider text-gold">Adjustments</div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Other charges (₹)">
              <NumField value={otherCharges} onChange={(n) => setOtherCharges(Math.max(0, Number(n) || 0))} min={0} />
            </Field>
            <Field label="Discount (₹)">
              <NumField value={discount} onChange={(n) => setDiscount(Math.max(0, Number(n) || 0))} min={0} />
            </Field>
          </div>
          {otherCharges > 0 && (
            <Field label="Other charges description">
              <input value={otherDescription} onChange={(e) => setOtherDescription(e.target.value)} placeholder="e.g. Airport pickup" className="qb-input" />
            </Field>
          )}
          <Field label="Total override (₹ — leave blank to use computed)">
            <input
              type="number"
              value={totalOverride}
              onChange={(e) => setTotalOverride(e.target.value)}
              placeholder={String(pricing.total)}
              className="qb-input"
              inputMode="decimal"
            />
          </Field>
          <div className="text-[11px] text-muted-foreground leading-snug">
            Lower override → Discount auto-derived · Higher override → Room Charges auto-increase. Identical logic to the Detailed Booking Form.
          </div>
        </section>

        {/* GROUP 5 — Pricing breakdown (shared component, same engine) */}
        <PricingBreakdownCard pricing={pricing} />

        {/* GROUP 6 — Inline advance + actions */}
        <section className="luxe-card rounded-xl p-4 space-y-3">
          <div className="text-xs uppercase tracking-wider text-gold">Initial Advance (optional)</div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Amount (₹)">
              <NumField value={advanceAmount} onChange={(n) => setAdvanceAmount(Math.max(0, Math.min(pricing.total, Number(n) || 0)))} min={0} />
            </Field>
            <Field label="Mode">
              <select value={paymentMode} onChange={(e) => setPaymentMode(e.target.value)} className="qb-input">
                {PAYMENT_MODES.map((m) => <option key={m}>{m}</option>)}
              </select>
            </Field>
          </div>
        </section>

        {errors.length > 0 && (
          <div className="text-xs text-destructive bg-destructive/10 rounded-md px-3 py-2">
            {errors[0]}
          </div>
        )}

        {createdBookingId && (
          <div className="rounded-md border border-gold/40 bg-gold-soft/50 px-3 py-2 text-sm">
            Booking saved.{" "}
            <button onClick={() => navigate({ to: "/bookings/$id", params: { id: createdBookingId } })} className="underline text-gold font-medium">
              Open detail →
            </button>
          </div>
        )}
      </div>

      {/* Sticky action bar */}
      <div className="fixed bottom-0 left-0 right-0 z-30 bg-card/95 backdrop-blur border-t border-border" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        <div className="mx-auto max-w-2xl px-3 py-2.5 flex items-center gap-2">
          <button
            type="button"
            onClick={() => ensureBookingThen(() => setChargeOpen(true))}
            disabled={save.isPending}
            className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-md border border-border bg-card text-sm py-2.5 hover:bg-secondary disabled:opacity-50"
          >
            <Receipt className="h-4 w-4" /> Add Charges
          </button>
          <button
            type="button"
            onClick={() => ensureBookingThen(() => setPaymentOpen(true))}
            disabled={save.isPending}
            className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-md border border-border bg-card text-sm py-2.5 hover:bg-secondary disabled:opacity-50"
          >
            <Wallet className="h-4 w-4" /> Add Payment
          </button>
          {!createdBookingId ? (
            <button
              type="button"
              onClick={() => save.mutate()}
              disabled={save.isPending || errors.length > 0}
              className="flex-[1.2] inline-flex items-center justify-center gap-1.5 rounded-md gold-gradient text-charcoal text-sm py-2.5 font-medium disabled:opacity-50"
            >
              {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <BedDouble className="h-4 w-4" />}
              Create Booking
            </button>
          ) : (
            <button
              type="button"
              onClick={() => navigate({ to: "/bookings/$id", params: { id: createdBookingId } })}
              className="flex-[1.2] inline-flex items-center justify-center gap-1.5 rounded-md gold-gradient text-charcoal text-sm py-2.5 font-medium"
            >
              View Booking
            </button>
          )}
        </div>
      </div>

      {/* Reused dialogs — identical to the ones the booking detail screen uses */}
      {chargeOpen && createdBookingId && (
        <ChargeFormDialog
          open={chargeOpen}
          onOpenChange={setChargeOpen}
          bookingId={createdBookingId}
          categories={chargeCategories}
          editing={null}
        />
      )}
      {paymentOpen && createdBookingId && (
        <AddBookingPaymentModal
          bookingId={createdBookingId}
          customerId={createdCustomerId ?? null}
          maxAmount={Math.max(0, pricing.total - advanceAmount)}
          payment={null}
          onClose={() => setPaymentOpen(false)}
          onSaved={() => setPaymentOpen(false)}
        />
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function Stepper({
  label, value, min, max, onChange, cls,
}: { label: string; value: number; min: number; max: number; onChange: (n: number) => void; cls: string }) {
  const dec = () => onChange(Math.max(min, value - 1));
  const inc = () => onChange(Math.min(max, value + 1));
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">{label}</div>
      <div className="flex items-center gap-2">
        <button type="button" onClick={dec} disabled={value <= min} className={cls} aria-label={`Decrease ${label}`}>
          <Minus className="h-4 w-4" />
        </button>
        <div className="flex-1 text-center font-medium tabular-nums">{value}</div>
        <button type="button" onClick={inc} disabled={value >= max} className={cls} aria-label={`Increase ${label}`}>
          <Plus className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
