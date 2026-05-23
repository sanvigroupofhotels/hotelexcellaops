import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import { useMutation } from "@tanstack/react-query";
import { Topbar } from "@/components/topbar";
import {
  roomTypes,
  EARLY_CHECK_IN_SLOTS,
  LATE_CHECK_OUT_SLOTS,
  EXTRA_ADULT_RATE,
  DRIVER_RATE,
  EXTRA_BREAKFAST_RATE,
} from "@/lib/mock-data";
import { createQuote, calc, type QuoteInput } from "@/lib/quotes-api";
import { PolicyFields, SummaryExtras } from "@/components/policy-fields";
import {
  User, Phone, Mail, Users, CalendarDays, Bed, Plus, Minus, Sparkles, Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/generate")({
  component: GenerateQuote,
});

const inputCls =
  "w-full bg-input/60 border border-border rounded-md px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-gold/40 focus:border-gold/50 transition";

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

  const c = useMemo(() => calc(form), [form]);

  const save = useMutation({
    mutationFn: () => {
      if (!form.guest_name.trim()) throw new Error("Guest name is required");
      if (!form.phone.trim()) throw new Error("Phone is required");
      if (new Date(form.check_out) <= new Date(form.check_in))
        throw new Error("Check-out must be after check-in");
      return createQuote(form);
    },
    onSuccess: (q) => {
      toast.success(`Quote ${q.reference_code} created`);
      navigate({ to: "/quote/$id", params: { id: q.id } });
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <>
      <Topbar title="Generate Quote" subtitle="Build a tailored stay proposal in seconds" />
      <div className="px-4 md:px-8 py-6 md:py-8 max-w-[1400px]">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
          <div className="space-y-6">
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
                    {["Direct","Website","WhatsApp","Referral","OTA"].map((o) => <option key={o}>{o}</option>)}
                  </select>
                </Field>
                <Field label="Special Requests">
                  <input className={inputCls} value={form.special_requests ?? ""} onChange={(e) => update("special_requests", e.target.value)} />
                </Field>
              </div>

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

            <Card title="Additional">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Discount (₹)">
                  <input type="number" min={0} className={inputCls} value={form.discount} onChange={(e) => update("discount", Number(e.target.value) || 0)} />
                </Field>
              </div>
              <Field label="Internal Notes">
                <textarea rows={3} className={cn(inputCls, "resize-none mt-1")} value={form.internal_notes ?? ""} onChange={(e) => update("internal_notes", e.target.value)} />
              </Field>
            </Card>
          </div>

          <div className="lg:sticky lg:top-24 self-start space-y-4">
            <div className="luxe-card rounded-xl p-5">
              <div className="flex items-center justify-between mb-4">
                <h4 className="font-display text-lg">Live Summary</h4>
                <Sparkles className="h-4 w-4 text-gold" />
              </div>
              <SummaryRow label={`Room Tariff (${c.nights}N)`} value={c.roomTariff} />
              <SummaryRow label="Extra Bed" value={c.extraBed} mute={!c.extraBed} />
              <SummaryRow label="Early Check-in" value={c.earlyCheck} mute={!c.earlyCheck} />
              <SummaryRow label="Late Check-out" value={c.lateCheck} mute={!c.lateCheck} />
              <SummaryRow label="Pet Charges" value={c.pet} mute={!c.pet} />
              <SummaryExtras c={c} form={form} />
              {form.discount > 0 && <SummaryRow label="Discount" value={-form.discount} />}
              <div className="luxe-divider my-3" />
              <SummaryRow label="Taxes & Fees" value={c.taxes} />
              <div className="mt-4 rounded-lg bg-gold-soft border border-gold/30 p-4">
                <div className="flex items-baseline justify-between">
                  <span className="text-sm text-gold/90">Total Amount</span>
                  <span className="font-display text-2xl text-gold">
                    ₹{c.total.toLocaleString("en-IN")}
                  </span>
                </div>
                <p className="text-[10px] text-gold/70 mt-1">Including all taxes</p>
              </div>
            </div>

            <button
              onClick={() => save.mutate()}
              disabled={save.isPending}
              className="w-full inline-flex items-center justify-center gap-2 rounded-md gold-gradient px-4 py-3 text-sm font-medium text-charcoal hover:shadow-[0_0_24px_oklch(0.82_0.13_82/0.35)] transition disabled:opacity-60"
            >
              {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Save & Preview Quote →
            </button>
          </div>
        </div>
      </div>
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

function NumField({
  label, hint, value, min = 0, onChange,
}: { label: string; hint?: string; value: number; min?: number; onChange: (v: number) => void }) {
  return (
    <label className="block">
      <span className="block text-[11px] uppercase tracking-wider text-muted-foreground mb-1">{label}</span>
      <input
        type="number"
        inputMode="numeric"
        pattern="[0-9]*"
        min={min}
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => {
          const n = parseInt(e.target.value, 10);
          onChange(Number.isFinite(n) && n >= min ? n : min);
        }}
        className="w-full bg-input/60 border border-border rounded-md px-3 py-3 text-base sm:text-sm font-medium tabular-nums text-foreground focus:outline-none focus:ring-2 focus:ring-gold/40 focus:border-gold/50 transition"
      />
      {hint && <span className="block text-[10px] text-muted-foreground/70 mt-1">{hint}</span>}
    </label>
  );
}
