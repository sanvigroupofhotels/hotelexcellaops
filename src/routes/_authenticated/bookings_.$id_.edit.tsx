import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Topbar } from "@/components/topbar";
import { getBooking, updateBooking } from "@/lib/bookings-api";
import { listBookingItems, replaceBookingItems, rowToLineItem } from "@/lib/booking-items-api";
import { type LineItem, lineSubtotal, nightsOf } from "@/components/line-items-editor";
import { computePricing, DEFAULT_TAX_RATE } from "@/lib/pricing";
import { PricingBreakdownCard, StickyPricingFooter } from "@/components/pricing-breakdown";
import { useResolvedRate } from "@/hooks/use-resolved-rate";
import { NumField } from "@/components/num-field";
import {
  StayFormSections, emptyStayValue, primaryToLineItem, lineItemToPrimary,
  type SharedStayValue,
} from "@/components/shared/stay-form-sections";
import { RoomAssignmentField } from "@/components/room-assignment-field";
import { useUserRole } from "@/hooks/use-role";
import { ArrowLeft, Loader2, Save } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { PaymentSettingsSection, type BookingPaymentFlags } from "@/components/payment-settings-section";

export const Route = createFileRoute("/_authenticated/bookings_/$id_/edit")({
  component: EditBooking,
});

const inputCls =
  "w-full bg-input/60 border border-border rounded-md px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gold/40 focus:border-gold/50 transition";

function EditBooking() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: b, isLoading } = useQuery({ queryKey: ["booking", id], queryFn: () => getBooking(id) });
  const { data: existingItems = [] } = useQuery({
    queryKey: ["booking-items", id], queryFn: () => listBookingItems(id), enabled: !!b,
  });

  const [stay, setStay] = useState<SharedStayValue>(() => emptyStayValue());
  const [extras, setExtras] = useState<LineItem[]>([]);
  const [advancePaid, setAdvancePaid] = useState<number>(0);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [totalOverride, setTotalOverride] = useState<number | null>(null);
  const [taxesIncluded, setTaxesIncluded] = useState<boolean>(false);
  const [paymentFlags, setPaymentFlags] = useState<BookingPaymentFlags>({
    allow_full_payment: true, allow_part_payment: true, allow_pay_at_hotel: true, part_payment_value: 25,
  });
  const [loaded, setLoaded] = useState(false);
  const { canManage } = useUserRole();

  useEffect(() => {
    if (!b || loaded) return;
    setStay((s) => ({
      ...s,
      guest_name: b.guest_name ?? "",
      phone: b.phone ?? "", email: b.email ?? "",
      adults: b.adults, children: b.children, guests: b.guests,
      check_in: b.check_in, check_out: b.check_out,
      discount: Number((b as any).discount ?? 0),
      special_requests: b.notes ?? "",
      internal_notes: b.internal_notes ?? "",
    }));
    setAdvancePaid(Number(b.advance_paid ?? 0));
    setRoomId((b as any).room_id ?? null);
    setTotalOverride((b as any).total_override == null ? null : Number((b as any).total_override));
    setTaxesIncluded(!!(b as any).taxes_included);
    setPaymentFlags({
      allow_full_payment: (b as any).allow_full_payment !== false,
      allow_part_payment: (b as any).allow_part_payment !== false,
      allow_pay_at_hotel: (b as any).allow_pay_at_hotel !== false,
      part_payment_value: Number((b as any).part_payment_value) || 25,
    });
  }, [b, loaded]);

  useEffect(() => {
    if (!b || existingItems.length === 0 || loaded) return;
    const items = existingItems.map(rowToLineItem);
    setStay((s) => ({ ...s, ...lineItemToPrimary(items[0]) } as SharedStayValue));
    setExtras(items.slice(1));
    setLoaded(true);
  }, [b, existingItems, loaded]);

  const resolvedRate = useResolvedRate(stay.room_type, stay.check_in, stay.check_out, stay.breakfast_included);
  const { pricing, roomCharges, extraCharges, nights } = useMemo(() => {
    const primary = primaryToLineItem(stay, resolvedRate);
    const p = computePricing([primary, ...extras], Number(stay.discount) || 0, DEFAULT_TAX_RATE, { totalOverride, taxesIncluded });
    return {
      pricing: p,
      roomCharges: lineSubtotal(primary),
      extraCharges: extras.reduce((s, i) => s + lineSubtotal(i), 0),
      nights: nightsOf(primary),
    };
  }, [stay, extras, resolvedRate, totalOverride, taxesIncluded]);
  const amount = pricing.total;
  const balance = Math.max(0, amount - Number(advancePaid));

  const save = useMutation({
    mutationFn: async () => {
      await updateBooking(id, {
        guest_name: stay.guest_name, phone: stay.phone, email: stay.email,
        check_in: stay.check_in, check_out: stay.check_out,
        adults: stay.adults, children: stay.children, guests: stay.guests,
        room_details: `${stay.room_type} × ${stay.rooms}`,
        room_id: roomId,
        amount,
        subtotal: pricing.subtotal,
        taxes: pricing.taxes,
        tax_rate: pricing.taxRate,
        advance_paid: advancePaid, discount: stay.discount,
        notes: stay.special_requests, internal_notes: stay.internal_notes,
        total_override: totalOverride,
        taxes_included: taxesIncluded,
      });
      const primary = primaryToLineItem(stay, resolvedRate);
      await replaceBookingItems(id, [primary, ...extras]);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["booking", id] });
      qc.invalidateQueries({ queryKey: ["booking-items", id] });
      toast.success("Booking updated");
      navigate({ to: "/bookings/$id", params: { id } });
    },
    onError: (e: any) => toast.error(e.message),
  });

  if (isLoading || !b) return <div className="p-20 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-gold" /></div>;

  return (
    <>
      <Topbar title="Edit Booking" subtitle={b.booking_reference} />
      <div className="px-4 md:px-8 py-6 md:py-8 max-w-[1400px] pb-56 lg:pb-8">
        <Link to="/bookings/$id" params={{ id }} className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-4">
          <ArrowLeft className="h-4 w-4" /> Back to booking
        </Link>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
          <div className="space-y-6">
            <StayFormSections
              value={stay} onChange={setStay}
              extras={extras} onExtrasChange={setExtras}
              mode="booking"
            />

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
              <p className="text-[10px] text-muted-foreground -mt-2">
                Status is auto-derived from amounts. Use Check-In / Check-Out buttons on the booking page for arrival &amp; departure.
              </p>
              <RoomAssignmentField
                value={roomId} onChange={setRoomId}
                check_in={stay.check_in} check_out={stay.check_out}
                excludeBookingId={id}
                roomType={stay.room_type}
              />
              <div className="rounded-md bg-secondary/40 border border-border px-3 py-2.5 flex items-center justify-between">
                <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Balance Payable</span>
                <span className="font-display text-lg gold-text-gradient">₹{balance.toLocaleString("en-IN")}</span>
              </div>
            </motion.section>

            {/* Inline breakdown hidden on mobile — sticky footer renders editable version. */}
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
            <button onClick={() => save.mutate()} disabled={save.isPending}
              className="w-full inline-flex items-center justify-center gap-2 rounded-md gold-gradient px-4 py-3 text-sm font-medium text-charcoal disabled:opacity-60">
              {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save Changes
            </button>
          </div>
        </div>

        {/* Sticky footer: editable pricing breakdown + Save Changes — mobile only */}
        <StickyPricingFooter
          pricing={pricing}
          editable={true}
          overrideValue={totalOverride}
          onOverrideChange={setTotalOverride}
          onTaxesIncludedChange={setTaxesIncluded}
          actions={
            <button onClick={() => save.mutate()} disabled={save.isPending}
              className="w-full inline-flex items-center justify-center gap-2 rounded-md gold-gradient px-4 py-2.5 text-sm font-medium text-charcoal disabled:opacity-60">
              {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save Changes
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
