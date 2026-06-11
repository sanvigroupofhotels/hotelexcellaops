import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useMemo, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Topbar } from "@/components/topbar";
import { roomTypes } from "@/lib/mock-data";
import { createQuote, calc, type QuoteInput } from "@/lib/quotes-api";
import { getCustomer, findCustomerByContact, type CustomerRow } from "@/lib/customers-api";
import { LiveSummaryCard, MobileStickySummary } from "@/components/quote-summary";
import { CustomerAutocomplete, ExistingCustomerBanner } from "@/components/customer-lookup";
import { lineItemsTotal, type LineItem } from "@/components/line-items-editor";
import { StayFormSections, type SharedStayValue } from "@/components/shared/stay-form-sections";
import { useResolvedRate } from "@/hooks/use-resolved-rate";
import {
  Loader2, Heart, Briefcase, UsersRound, Dog, CalendarRange, UserPlus,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/generate")({
  validateSearch: (search: Record<string, unknown>) => ({
    customerId: typeof search.customerId === "string" ? search.customerId : undefined,
  }),
  component: GenerateQuote,
});

// ---------- One-click quote presets ----------
type QuotePreset = { label: string; hint: string; icon: any; patch: (f: QuoteInput) => Partial<QuoteInput>; };
const QUOTE_PRESETS: QuotePreset[] = [
  { label: "Couple Stay", hint: "2 adults · breakfast included", icon: Heart,
    patch: () => ({ guests: 2, adults: 2, children: 0, rooms: 1, breakfast_included: true, extra_adults: 0, drivers: 0, pet_size: "none", pet_charges: false, group_size: "2 Guests" }) },
  { label: "Family Stay", hint: "2 adults + 2 children", icon: UsersRound,
    patch: () => ({ guests: 4, adults: 2, children: 2, rooms: 1, breakfast_included: true, extra_adults: 0, drivers: 0, pet_size: "none", pet_charges: false, group_size: "4 Guests" }) },
  { label: "Corporate Single", hint: "1 adult · breakfast included", icon: Briefcase,
    patch: () => ({ guests: 1, adults: 1, children: 0, rooms: 1, breakfast_included: true, extra_adults: 0, drivers: 0, pet_size: "none", pet_charges: false, group_size: "1 Guest", lead_source: "Direct" }) },
  { label: "Group Booking", hint: "Multiple rooms", icon: UserPlus,
    patch: () => ({ rooms: 3, guests: 6, adults: 6, children: 0, breakfast_included: true, group_size: "6 Guests" }) },
  { label: "Pet Stay", hint: "Small pet charges", icon: Dog,
    patch: (f) => ({ ...f, pet_charges: true, pet_size: "small" as const }) },
  { label: "Long Stay", hint: "+7 nights", icon: CalendarRange,
    patch: (f) => {
      const inDate = new Date(f.check_in);
      const out = new Date(inDate.getTime() + 7 * 86400000);
      return { check_out: toLocalYMD(out) };
    } },
];

/** Project QuoteInput → SharedStayValue (for the shared sections). */
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

function GenerateQuote() {
  const navigate = useNavigate();
  const { customerId } = Route.useSearch();
  const today = toLocalYMD();
  const tomorrow = localYMDOffset(1);

  const [form, setForm] = useState<QuoteInput>({
    guest_name: "", phone: "", email: "",
    lead_source: "Direct", group_size: "2 Adults", special_requests: "",
    check_in: today, check_out: tomorrow,
    room_type: roomTypes[0].name, rooms: 1, extra_bed: 0,
    adults: 2, guests: 2, children: 0, pet_size: "none",
    early_check_in: false, early_check_in_slot: null,
    late_check_out: false, late_check_out_slot: null,
    pet_charges: false, extra_adults: 0, drivers: 0,
    breakfast_included: false, extra_breakfast_guests: 0,
    discount: 0, internal_notes: "",
    payment_status: "None", booking_probability: 50, lost_reason: null,
  });
  const [extraItems, setExtraItems] = useState<LineItem[]>([]);
  const [matchedCustomer, setMatchedCustomer] = useState<CustomerRow | null>(null);
  const [forceNew, setForceNew] = useState(false);

  // Prefill via ?customerId
  const { data: prefill } = useQuery({
    queryKey: ["customer-prefill", customerId],
    queryFn: () => getCustomer(customerId!),
    enabled: !!customerId, staleTime: 60_000,
  });
  useEffect(() => {
    if (!prefill) return;
    setForm((f) => ({
      ...f,
      guest_name: prefill.guest_name ?? f.guest_name,
      phone: prefill.phone ?? f.phone,
      email: prefill.email ?? f.email,
      lead_source: prefill.lead_source ?? f.lead_source,
      room_type: prefill.preferred_room ?? f.room_type,
    }));
    setMatchedCustomer(prefill);
    toast.success(`Prefilled for ${prefill.guest_name}`);
  }, [prefill]);

  // Existing-customer auto-detect
  useEffect(() => {
    if (forceNew) return;
    const phoneOk = form.phone.trim().length >= 7;
    const emailOk = !!form.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email);
    if (!phoneOk && !emailOk) { setMatchedCustomer(null); return; }
    const t = setTimeout(async () => {
      const c = await findCustomerByContact(
        phoneOk ? form.phone.trim() : undefined,
        emailOk ? form.email! : undefined,
        form.guest_name,
      );
      if (!c) { setMatchedCustomer(null); return; }
      const exact = phoneOk && c.phone === form.phone.trim()
        && (c.guest_name ?? "").trim().toLowerCase() === form.guest_name.trim().toLowerCase();
      if (exact) {
        setForm((f) => ({ ...f, lead_source: c.lead_source ?? f.lead_source }));
        setMatchedCustomer(null); return;
      }
      setMatchedCustomer(c);
    }, 400);
    return () => clearTimeout(t);
  }, [form.phone, form.email, form.guest_name, forceNew]);

  // Rate resolver: Override → Weekend → Weekday → Default (mirrors Bookings).
  const resolvedRate = useResolvedRate(form.room_type, form.check_in, form.check_out, form.breakfast_included);
  const c = useMemo(() => {
    const base = calc(form, resolvedRate);
    const extra = lineItemsTotal(extraItems);
    const subtotal = base.subtotal + extra;
    const taxes = Math.round(subtotal * 0.05);
    return { ...base, subtotal, taxes, total: subtotal + taxes };
  }, [form, extraItems, resolvedRate]);

  const save = useMutation({
    mutationFn: () => {
      if (!form.guest_name.trim()) throw new Error("Guest name is required");
      if (!form.phone.trim()) throw new Error("Phone is required");
      if (new Date(form.check_out) <= new Date(form.check_in))
        throw new Error("Check-out must be after check-in");
      return createQuote(form, "Pending", extraItems, resolvedRate);
    },
    onSuccess: (q) => {
      toast.success(`Quote ${q.reference_code} created`);
      navigate({ to: "/quote/$id", params: { id: q.id } });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const useExistingCustomer = () => {
    if (!matchedCustomer) return;
    setForm((f) => ({
      ...f,
      guest_name: matchedCustomer.guest_name,
      phone: matchedCustomer.phone ?? f.phone,
      email: matchedCustomer.email ?? f.email,
      lead_source: matchedCustomer.lead_source ?? f.lead_source,
    }));
    setForceNew(false);
    toast.success(`Using existing customer: ${matchedCustomer.guest_name}`);
  };

  const applyPreset = (preset: QuotePreset) => {
    setForm((f) => ({ ...f, ...preset.patch(f) }));
    toast.success(`Applied: ${preset.label}`);
  };

  const shared = quoteToShared(form);
  const customerSlot = (
    <>
      {matchedCustomer && !forceNew && (
        <div className="mt-4">
          <ExistingCustomerBanner
            customer={matchedCustomer}
            onUseExisting={useExistingCustomer}
            onCreateNew={() => { setForceNew(true); toast.info("Will create a new customer record."); }}
          />
        </div>
      )}
      {(form.guest_name.trim().length >= 2 || form.phone.trim().length >= 2) && !matchedCustomer && (
        <div className="mt-3">
          <CustomerAutocomplete
            name={form.guest_name} phone={form.phone} email={form.email ?? ""}
            onPick={(c) => {
              setForm((f) => ({
                ...f, guest_name: c.guest_name,
                phone: c.phone ?? f.phone, email: c.email ?? f.email,
                lead_source: c.lead_source ?? f.lead_source,
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
      <Topbar title="Generate Quote" subtitle="Build a tailored stay proposal in seconds" />
      <div className="px-4 md:px-8 py-6 md:py-8 max-w-[1400px] pb-32 lg:pb-8">
        <div className="mb-5 flex gap-2 overflow-x-auto pb-1 -mx-4 px-4 md:mx-0 md:px-0">
          {QUOTE_PRESETS.map((p) => {
            const Icon = p.icon;
            return (
              <button key={p.label} onClick={() => applyPreset(p)}
                className="shrink-0 inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:border-gold/40 transition"
                title={p.hint}>
                <Icon className="h-3.5 w-3.5 text-gold" />
                {p.label}
              </button>
            );
          })}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
          <StayFormSections
            value={shared}
            onChange={(next) => setForm((f) => mergeShared(f, next))}
            extras={extraItems}
            onExtrasChange={setExtraItems}
            customerSlot={customerSlot}
            nightsLabel={`${c.nights} Night${c.nights > 1 ? "s" : ""}`}
            mode="quote"
          />

          <div className="hidden lg:block lg:sticky lg:top-24 self-start space-y-4">
            <LiveSummaryCard c={c} form={form} />
            <button onClick={() => save.mutate()} disabled={save.isPending}
              className="w-full inline-flex items-center justify-center gap-2 rounded-md gold-gradient px-4 py-3 text-sm font-medium text-charcoal hover:shadow-[0_0_24px_oklch(0.82_0.13_82/0.35)] transition disabled:opacity-60">
              {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Save & Preview →
            </button>
          </div>
        </div>
      </div>

      <MobileStickySummary c={c} form={form} saving={save.isPending}
        primaryLabel="Save & Preview" onPrimary={() => save.mutate()} />
    </>
  );
}
