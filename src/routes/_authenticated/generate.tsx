import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useMemo, useEffect } from "react";
import { motion } from "framer-motion";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Topbar } from "@/components/topbar";
import {
  roomTypes,
  LEAD_SOURCES,
} from "@/lib/mock-data";
import { createQuote, calc, type QuoteInput } from "@/lib/quotes-api";
import { getCustomer, findCustomerByContact, type CustomerRow } from "@/lib/customers-api";
import { PolicyFields } from "@/components/policy-fields";
import { NumField } from "@/components/num-field";
import { LiveSummaryCard, MobileStickySummary } from "@/components/quote-summary";
import { CustomerAutocomplete, ExistingCustomerBanner } from "@/components/customer-lookup";
import { LineItemsEditor, lineItemsTotal, type LineItem } from "@/components/line-items-editor";
import {
  User, Phone, Mail, Users, CalendarDays, Bed, Plus, Minus, Loader2, Save,
  Heart, Briefcase, UsersRound, Dog, CalendarRange, UserPlus,
} from "lucide-react";
import { cn } from "@/lib/utils";

import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/generate")({
  validateSearch: (search: Record<string, unknown>) => ({
    customerId: typeof search.customerId === "string" ? search.customerId : undefined,
  }),
  component: GenerateQuote,
});

const inputCls =
  "w-full bg-input/60 border border-border rounded-md px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-gold/40 focus:border-gold/50 transition";

// ---------- One-click quote presets (front-desk shortcuts) ----------
type QuotePreset = {
  label: string;
  hint: string;
  icon: any;
  patch: (f: QuoteInput) => Partial<QuoteInput>;
};

const QUOTE_PRESETS: QuotePreset[] = [
  {
    label: "Couple Stay", hint: "2 adults · breakfast included", icon: Heart,
    patch: () => ({ guests: 2, adults: 2, children: 0, rooms: 1, breakfast_included: true, extra_adults: 0, drivers: 0, pet_size: "none", pet_charges: false, group_size: "2 Guests" }),
  },
  {
    label: "Family Stay", hint: "2 adults + 2 children", icon: UsersRound,
    patch: () => ({ guests: 4, adults: 2, children: 2, rooms: 1, breakfast_included: true, extra_adults: 0, drivers: 0, pet_size: "none", pet_charges: false, group_size: "4 Guests" }),
  },
  {
    label: "Corporate Single", hint: "1 adult · breakfast included", icon: Briefcase,
    patch: () => ({ guests: 1, adults: 1, children: 0, rooms: 1, breakfast_included: true, extra_adults: 0, drivers: 0, pet_size: "none", pet_charges: false, group_size: "1 Guest", lead_source: "Direct" }),
  },
  {
    label: "Group Booking", hint: "Multiple rooms", icon: UserPlus,
    patch: () => ({ rooms: 3, guests: 6, adults: 6, children: 0, breakfast_included: true, group_size: "6 Guests" }),
  },
  {
    label: "Pet Stay", hint: "Small pet charges", icon: Dog,
    patch: (f) => ({ ...f, pet_charges: true, pet_size: "small" as const }),
  },
  {
    label: "Long Stay", hint: "+7 nights", icon: CalendarRange,
    patch: (f) => {
      const inDate = new Date(f.check_in);
      const out = new Date(inDate.getTime() + 7 * 86400000);
      return { check_out: out.toISOString().slice(0, 10) };
    },
  },
];


function Field({ label, icon: Icon, children, required }: any) {
  return (
    <label className="block">
      <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">
        {Icon && <Icon className="h-3 w-3" />}
        {label}
        {required && <span className="text-gold">*</span>}
      </span>
      {children}
    </label>
  );
}

function GenerateQuote() {
  const navigate = useNavigate();
  const { customerId } = Route.useSearch();
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

  const [form, setForm] = useState<QuoteInput>({
    guest_name: "", phone: "", email: "",
    lead_source: "Direct", group_size: "2 Adults", special_requests: "",
    check_in: today, check_out: tomorrow,
    room_type: roomTypes[0].name, rooms: 1, extra_bed: 0,
    adults: 2, guests: 2, children: 0, pet_size: "none",
    early_check_in: false, early_check_in_slot: null,
    late_check_out: false, late_check_out_slot: null,
    pet_charges: false, extra_adults: 0, drivers: 0,
    breakfast_included: true, extra_breakfast_guests: 0,
    discount: 0, internal_notes: "",
    payment_status: "None", booking_probability: 50, lost_reason: null,
  });
  const update = <K extends keyof QuoteInput>(k: K, v: QuoteInput[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  // Multi-line items (additional rooms beyond the primary form line).
  const [extraItems, setExtraItems] = useState<LineItem[]>([]);

  // Existing-customer banner state. Null = no match yet. linkedId = "Use existing".
  const [matchedCustomer, setMatchedCustomer] = useState<CustomerRow | null>(null);
  const [forceNew, setForceNew] = useState(false);

  // Prefill from customer when ?customerId=… is present (repeat-guest workflow).
  const { data: prefill } = useQuery({
    queryKey: ["customer-prefill", customerId],
    queryFn: () => getCustomer(customerId!),
    enabled: !!customerId,
    staleTime: 60_000,
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

  // Auto-detect existing customer by contact (phone/email) — debounced.
  useEffect(() => {
    if (forceNew) return;
    const phoneOk = form.phone.trim().length >= 7;
    const emailOk = !!form.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email);
    if (!phoneOk && !emailOk) { setMatchedCustomer(null); return; }
    const t = setTimeout(async () => {
      const c = await findCustomerByContact(
        phoneOk ? form.phone.trim() : undefined,
        emailOk ? form.email! : undefined,
      );
      setMatchedCustomer(c);
    }, 400);
    return () => clearTimeout(t);
  }, [form.phone, form.email, forceNew]);

  const c = useMemo(() => {
    const base = calc(form);
    const extra = lineItemsTotal(extraItems);
    const subtotal = base.subtotal + extra;
    const taxes = Math.round(subtotal * 0.05);
    return { ...base, subtotal, taxes, total: subtotal + taxes };
  }, [form, extraItems]);

  const save = useMutation({
    mutationFn: (asDraft?: boolean) => {
      if (!form.guest_name.trim()) throw new Error("Guest name is required");
      if (!form.phone.trim()) throw new Error("Phone is required");
      if (new Date(form.check_out) <= new Date(form.check_in))
        throw new Error("Check-out must be after check-in");
      return createQuote(form, asDraft ? "Draft" : undefined, extraItems);
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

  return (
    <>
      <Topbar title="Generate Quote" subtitle="Build a tailored stay proposal in seconds" />
      <div className="px-4 md:px-8 py-6 md:py-8 max-w-[1400px] pb-32 lg:pb-8">
        {/* One-click presets */}
        <div className="mb-5 flex gap-2 overflow-x-auto pb-1 -mx-4 px-4 md:mx-0 md:px-0">
          {QUOTE_PRESETS.map((p) => {
            const Icon = p.icon;
            return (
              <button
                key={p.label}
                onClick={() => applyPreset(p)}
                className="shrink-0 inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:border-gold/40 transition"
                title={p.hint}
              >
                <Icon className="h-3.5 w-3.5 text-gold" />
                {p.label}
              </button>
            );
          })}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">

          <div className="space-y-6">
            {matchedCustomer && !forceNew && (
              <ExistingCustomerBanner
                customer={matchedCustomer}
                onUseExisting={useExistingCustomer}
                onCreateNew={() => { setForceNew(true); toast.info("Will create a new customer record."); }}
              />
            )}

            <Card title="Guest Details">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Guest Name" icon={User} required>
                  <input className={inputCls} value={form.guest_name} onChange={(e) => update("guest_name", e.target.value)} />
                </Field>
                <Field label="Phone" icon={Phone} required>
                  <input className={inputCls} placeholder="+91 ..." value={form.phone} onChange={(e) => update("phone", e.target.value)} />
                </Field>
                <Field label="Email" icon={Mail}>
                  <input className={inputCls} value={form.email ?? ""} onChange={(e) => update("email", e.target.value)} />
                </Field>
                <Field label="Lead Source">
                  <select className={inputCls} value={form.lead_source} onChange={(e) => update("lead_source", e.target.value)}>
                    {LEAD_SOURCES.map((o) => <option key={o}>{o}</option>)}
                  </select>
                </Field>
                <Field label="Special Requests">
                  <input className={inputCls} value={form.special_requests ?? ""} onChange={(e) => update("special_requests", e.target.value)} />
                </Field>
              </div>

              {/* Name/phone autocomplete suggestions */}
              {(form.guest_name.trim().length >= 2 || form.phone.trim().length >= 2) && !matchedCustomer && (
                <div className="mt-3">
                  <CustomerAutocomplete
                    name={form.guest_name}
                    phone={form.phone}
                    email={form.email ?? ""}
                    onPick={(c) => {
                      setForm((f) => ({
                        ...f,
                        guest_name: c.guest_name,
                        phone: c.phone ?? f.phone,
                        email: c.email ?? f.email,
                        lead_source: c.lead_source ?? f.lead_source,
                      }));
                      setMatchedCustomer(c);
                      setForceNew(false);
                    }}
                  />
                </div>
              )}

              {/* Group size — manual numeric inputs */}
              <div className="mt-5 rounded-lg border border-border bg-secondary/30 p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Users className="h-4 w-4 text-gold" />
                  <span className="text-sm font-medium">Group Size</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <NumField
                    label="# of Guests"
                    hint="Primary count"
                    value={form.guests}
                    min={1}
                    onChange={(v) => {
                      update("guests", v);
                      update("group_size", `${v} Guest${v > 1 ? "s" : ""}`);
                      if (form.adults > v) update("adults", v);
                    }}
                  />
                  <NumField
                    label="# of Adults"
                    hint="Optional"
                    value={form.adults}
                    min={0}
                    onChange={(v) => update("adults", v)}
                  />
                  <NumField
                    label="# of Children"
                    hint="Age below 8 years"
                    value={form.children}
                    min={0}
                    onChange={(v) => update("children", v)}
                  />
                </div>
                {form.adults > 0 && form.children >= 0 &&
                  form.adults + form.children !== form.guests && (
                    <p className="mt-2 text-[11px] text-warning">
                      Adults ({form.adults}) + Children ({form.children}) ≠ Total Guests ({form.guests}).
                    </p>
                  )}
              </div>
            </Card>

            <Card title="Stay Details">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Check-in" icon={CalendarDays} required>
                  <input type="date" className={inputCls} value={form.check_in} onChange={(e) => update("check_in", e.target.value)} />
                </Field>
                <Field label="Check-out" icon={CalendarDays} required>
                  <input type="date" className={inputCls} value={form.check_out} onChange={(e) => update("check_out", e.target.value)} />
                </Field>
              </div>
              <div className="mt-2 text-right text-xs text-gold">
                {c.nights} Night{c.nights > 1 ? "s" : ""}
              </div>
            </Card>

            <Card title="Room & Extras">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Room Type" icon={Bed}>
                  <select className={inputCls} value={form.room_type} onChange={(e) => update("room_type", e.target.value)}>
                    {roomTypes.map((r) => <option key={r.name}>{r.name}</option>)}
                  </select>
                </Field>
                <Field label="Rooms">
                  <Stepper value={form.rooms} min={1} onChange={(v) => update("rooms", v)} />
                </Field>
                <Field label="Extra Bed">
                  <Stepper value={form.extra_bed} min={0} onChange={(v) => update("extra_bed", v)} />
                </Field>
                <div />
              </div>
              <div className="mt-4">
                <PolicyFields form={form} update={update} />
              </div>
            </Card>

            <Card title="Additional Rooms / Split Stay">
              <LineItemsEditor items={extraItems} onChange={setExtraItems} />
            </Card>

            <Card title="Additional">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Discount (₹)">
                  <NumField label="" value={form.discount} min={0} onChange={(v) => update("discount", v)} />
                </Field>
              </div>
              <Field label="Internal Notes">
                <textarea rows={3} className={cn(inputCls, "resize-none mt-1")} value={form.internal_notes ?? ""} onChange={(e) => update("internal_notes", e.target.value)} />
              </Field>
            </Card>
          </div>

          <div className="hidden lg:block lg:sticky lg:top-24 self-start space-y-4">
            <LiveSummaryCard c={c} form={form} />

            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => save.mutate(true)}
                disabled={save.isPending}
                className="inline-flex items-center justify-center gap-2 rounded-md border border-border bg-card px-4 py-3 text-sm font-medium text-foreground hover:border-gold/40 transition disabled:opacity-60"
                title="Save as draft — won't send to guest"
              >
                <Save className="h-4 w-4" />
                Save Draft
              </button>
              <button
                onClick={() => save.mutate(false)}
                disabled={save.isPending}
                className="inline-flex items-center justify-center gap-2 rounded-md gold-gradient px-4 py-3 text-sm font-medium text-charcoal hover:shadow-[0_0_24px_oklch(0.82_0.13_82/0.35)] transition disabled:opacity-60"
              >
                {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Save & Preview →
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile sticky bottom summary + actions with expandable breakdown */}
      <MobileStickySummary
        c={c}
        form={form}
        saving={save.isPending}
        primaryLabel="Save & Preview"
        onPrimary={() => save.mutate(false)}
        secondaryLabel="Draft"
        onSecondary={() => save.mutate(true)}
      />
    </>
  );
}


function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="luxe-card rounded-xl p-5 md:p-6"
    >
      <h4 className="font-display text-lg mb-4">{title}</h4>
      {children}
    </motion.section>
  );
}

function Stepper({ value, min = 0, onChange }: { value: number; min?: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center bg-input/60 border border-border rounded-md overflow-hidden">
      <button type="button" onClick={() => onChange(Math.max(min, value - 1))} className="p-2.5 hover:bg-secondary transition text-muted-foreground hover:text-foreground">
        <Minus className="h-3.5 w-3.5" />
      </button>
      <div className="flex-1 text-center text-sm font-medium">{value}</div>
      <button type="button" onClick={() => onChange(value + 1)} className="p-2.5 hover:bg-secondary transition text-muted-foreground hover:text-foreground">
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function ToggleRow({ label, checked, onChange, icon }: any) {
  return (
    <div className="flex items-center justify-between rounded-md bg-secondary/40 border border-border px-3 py-2.5">
      <span className="text-sm flex items-center gap-2">
        {icon && <span className="text-base">{icon}</span>}
        {label}
      </span>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={cn("relative h-5 w-9 rounded-full transition", checked ? "gold-gradient" : "bg-muted")}
      >
        <motion.span
          animate={{ x: checked ? 16 : 2 }}
          transition={{ type: "spring", stiffness: 500, damping: 30 }}
          className="absolute top-0.5 h-4 w-4 rounded-full bg-background shadow"
        />
      </button>
    </div>
  );
}

