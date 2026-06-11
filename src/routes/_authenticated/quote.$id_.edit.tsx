import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { toLocalYMD, localYMDOffset } from "@/lib/utils";
import { useEffect, useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Topbar } from "@/components/topbar";
import { roomTypes } from "@/lib/mock-data";
import {
  getQuote, updateQuote, calc, finalizeTotals, type QuoteInput,
} from "@/lib/quotes-api";
import { listQuoteItems, replaceQuoteItems, rowToLineItem } from "@/lib/quote-items-api";
import { LiveSummaryCard, MobileStickySummary } from "@/components/quote-summary";
import { lineItemsTotal, type LineItem } from "@/components/line-items-editor";
import { StayFormSections, type SharedStayValue } from "@/components/shared/stay-form-sections";
import { useResolvedRate } from "@/hooks/use-resolved-rate";
import { Loader2, ArrowLeft } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/quote/$id_/edit")({
  component: EditQuote,
});

const empty: QuoteInput = {
  guest_name: "", phone: "", email: "", lead_source: "Direct",
  group_size: "2 Adults", special_requests: "",
  check_in: toLocalYMD(),
  check_out: localYMDOffset(1),
  room_type: roomTypes[0].name, rooms: 1, extra_bed: 0,
  adults: 2, guests: 2, children: 0, pet_size: "none",
  early_check_in: false, early_check_in_slot: null,
  late_check_out: false, late_check_out_slot: null,
  pet_charges: false, extra_adults: 0, drivers: 0,
  breakfast_included: true, extra_breakfast_guests: 0,
  discount: 0, internal_notes: "",
  payment_status: "None", booking_probability: 50, lost_reason: null,
  total_override: null, taxes_included: false,
};

function quoteToShared(q: QuoteInput): SharedStayValue {
  return {
    guest_name: q.guest_name, phone: q.phone, email: q.email ?? "",
    lead_source: q.lead_source ?? "Direct",
    special_requests: q.special_requests ?? "",
    adults: q.adults, children: q.children, guests: q.guests,
    check_in: q.check_in, check_out: q.check_out,
    room_type: q.room_type, rooms: q.rooms, extra_bed: q.extra_bed,
    breakfast_included: q.breakfast_included,
    extra_breakfast_guests: q.extra_breakfast_guests,
    early_check_in: q.early_check_in, early_check_in_slot: q.early_check_in_slot ?? null,
    late_check_out: q.late_check_out, late_check_out_slot: q.late_check_out_slot ?? null,
    pet_size: q.pet_size, pet_charges: q.pet_charges,
    extra_adults: q.extra_adults, drivers: q.drivers,
    discount: q.discount, internal_notes: q.internal_notes ?? "",
  };
}
function mergeShared(prev: QuoteInput, s: SharedStayValue): QuoteInput {
  return {
    ...prev,
    guest_name: s.guest_name, phone: s.phone, email: s.email,
    lead_source: s.lead_source, special_requests: s.special_requests,
    adults: s.adults, children: s.children, guests: s.guests,
    group_size: `${s.guests} Guest${s.guests > 1 ? "s" : ""}`,
    check_in: s.check_in, check_out: s.check_out,
    room_type: s.room_type, rooms: s.rooms, extra_bed: s.extra_bed,
    breakfast_included: s.breakfast_included,
    extra_breakfast_guests: s.extra_breakfast_guests,
    early_check_in: s.early_check_in, early_check_in_slot: s.early_check_in_slot,
    late_check_out: s.late_check_out, late_check_out_slot: s.late_check_out_slot,
    pet_size: s.pet_size, pet_charges: s.pet_charges,
    extra_adults: s.extra_adults, drivers: s.drivers,
    discount: s.discount, internal_notes: s.internal_notes,
  };
}

function EditQuote() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: q, isLoading } = useQuery({ queryKey: ["quote", id], queryFn: () => getQuote(id) });
  const { data: existingItems = [] } = useQuery({
    queryKey: ["quote-items", id], queryFn: () => listQuoteItems(id), enabled: !!q,
  });
  const [form, setForm] = useState<QuoteInput>(empty);
  const [extraItems, setExtraItems] = useState<LineItem[]>([]);
  const [itemsLoaded, setItemsLoaded] = useState(false);

  useEffect(() => {
    if (!q) return;
    setForm({
      guest_name: q.guest_name, phone: q.phone, email: q.email ?? "",
      lead_source: q.lead_source ?? "Direct", group_size: q.group_size ?? "2 Adults",
      special_requests: q.special_requests ?? "",
      check_in: q.check_in, check_out: q.check_out,
      room_type: q.room_type, rooms: q.rooms, extra_bed: q.extra_bed,
      adults: (q as any).adults ?? 2, guests: (q as any).guests ?? 2, children: (q as any).children ?? 0,
      pet_size: ((q as any).pet_size ?? "none") as any,
      early_check_in: q.early_check_in,
      early_check_in_slot: q.early_check_in_slot ?? null,
      late_check_out: q.late_check_out,
      late_check_out_slot: q.late_check_out_slot ?? null,
      pet_charges: q.pet_charges,
      extra_adults: q.extra_adults ?? 0,
      drivers: q.drivers ?? 0,
      breakfast_included: q.breakfast_included ?? true,
      extra_breakfast_guests: q.extra_breakfast_guests ?? 0,
      discount: Number(q.discount) || 0,
      internal_notes: q.internal_notes ?? "",
      payment_status: ((q as any).payment_status ?? "None") as any,
      booking_probability: (q as any).booking_probability ?? 50,
      lost_reason: (q as any).lost_reason ?? null,
      total_override: (q as any).total_override == null ? null : Number((q as any).total_override),
      taxes_included: !!(q as any).taxes_included,
    });
  }, [q]);

  useEffect(() => {
    if (itemsLoaded || existingItems.length === 0) return;
    setExtraItems(existingItems.slice(1).map(rowToLineItem));
    setItemsLoaded(true);
  }, [existingItems, itemsLoaded]);

  // Rate resolver: Override → Weekend → Weekday → Default (mirrors Bookings).
  const resolvedRate = useResolvedRate(form.room_type, form.check_in, form.check_out, form.breakfast_included);
  const c = useMemo(() => {
    const base = calc(form, resolvedRate);
    const extra = lineItemsTotal(extraItems);
    const rawBase = (base.roomTariff + base.earlyCheck + base.lateCheck + base.pet + base.extraAdults + base.driversCharge + base.extraBreakfast) - (form.discount || 0);
    const { subtotal, taxes, total } = finalizeTotals(rawBase + extra, {
      totalOverride: form.total_override ?? null,
      taxesIncluded: !!form.taxes_included,
    });
    return { ...base, subtotal, taxes, total };
  }, [form, extraItems, resolvedRate]);

  const save = useMutation({
    mutationFn: async () => {
      if (!form.guest_name.trim()) throw new Error("Guest name is required");
      if (!form.phone.trim()) throw new Error("Phone is required");
      if (new Date(form.check_out) <= new Date(form.check_in))
        throw new Error("Check-out must be after check-in");
      if (form.discount < 0) throw new Error("Discount cannot be negative");
      const primary: LineItem = {
        room_type: form.room_type, rooms: form.rooms,
        adults: form.adults, children: form.children,
        check_in: form.check_in, check_out: form.check_out,
        breakfast_included: form.breakfast_included, extra_bed: form.extra_bed,
        rate: resolvedRate ?? 0,
        early_check_in: form.early_check_in, early_check_in_slot: form.early_check_in_slot ?? null,
        late_check_out: form.late_check_out, late_check_out_slot: form.late_check_out_slot ?? null,
        pet_size: form.pet_size, extra_adults: form.extra_adults, drivers: form.drivers,
      };
      const updated = await updateQuote(id, form, resolvedRate, extraItems as any);
      await replaceQuoteItems(id, [primary, ...extraItems]);
      return updated;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["quote", id] });
      qc.invalidateQueries({ queryKey: ["quote-items", id] });
      qc.invalidateQueries({ queryKey: ["quotes"] });
      qc.invalidateQueries({ queryKey: ["activities", id] });
      toast.success("Quote updated");
      navigate({ to: "/quote/$id", params: { id } });
    },
    onError: (e: any) => toast.error(e.message),
  });

  if (isLoading || !q) {
    return <div className="p-20 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-gold" /></div>;
  }

  const shared = quoteToShared(form);

  return (
    <>
      <Topbar title="Edit Quote" subtitle={q.reference_code} />
      <div className="px-4 md:px-8 py-6 md:py-8 max-w-[1400px] pb-32 lg:pb-8">
        <Link to="/quote/$id" params={{ id }} className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-4">
          <ArrowLeft className="h-4 w-4" /> Back to quote
        </Link>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
          <StayFormSections
            value={shared}
            onChange={(next) => setForm((f) => mergeShared(f, next))}
            extras={extraItems}
            onExtrasChange={setExtraItems}
            nightsLabel={`${c.nights} Night${c.nights > 1 ? "s" : ""}`}
            mode="quote"
          />

          <div className="hidden lg:block lg:sticky lg:top-24 self-start space-y-4">
            <LiveSummaryCard c={c} form={form} />
            <button onClick={() => save.mutate()} disabled={save.isPending}
              className="w-full inline-flex items-center justify-center gap-2 rounded-md gold-gradient px-4 py-3 text-sm font-medium text-charcoal hover:shadow-[0_0_24px_oklch(0.82_0.13_82/0.35)] transition disabled:opacity-60">
              {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Save Changes
            </button>
          </div>
        </div>
      </div>

      <MobileStickySummary c={c} form={form} saving={save.isPending}
        primaryLabel="Save Changes" onPrimary={() => save.mutate()} />
    </>
  );
}
