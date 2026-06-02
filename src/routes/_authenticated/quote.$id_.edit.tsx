import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState, useMemo } from "react";
import { motion } from "framer-motion";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Topbar } from "@/components/topbar";
import { roomTypes, LEAD_SOURCES } from "@/lib/mock-data";
import {
  getQuote, updateQuote, calc, TAX_RATE, type QuoteInput,
} from "@/lib/quotes-api";
import { listQuoteItems, replaceQuoteItems } from "@/lib/quote-items-api";
import { PolicyFields } from "@/components/policy-fields";
import { NumField } from "@/components/num-field";
import { LiveSummaryCard, MobileStickySummary } from "@/components/quote-summary";
import { LineItemsEditor, lineItemsTotal, type LineItem } from "@/components/line-items-editor";
import {
  User, Phone, Mail, Users, CalendarDays, Bed, Plus, Minus, Loader2, ArrowLeft,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/quote/$id_/edit")({
  component: EditQuote,
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

const empty: QuoteInput = {
  guest_name: "", phone: "", email: "", lead_source: "Direct",
  group_size: "2 Adults", special_requests: "",
  check_in: new Date().toISOString().slice(0, 10),
  check_out: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
  room_type: roomTypes[0].name, rooms: 1, extra_bed: 0,
  adults: 2, guests: 2, children: 0, pet_size: "none",
  early_check_in: false, early_check_in_slot: null,
  late_check_out: false, late_check_out_slot: null,
  pet_charges: false, extra_adults: 0, drivers: 0,
  breakfast_included: true, extra_breakfast_guests: 0,
  discount: 0, internal_notes: "",
  payment_status: "None", booking_probability: 50, lost_reason: null,
};

function EditQuote() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: q, isLoading } = useQuery({ queryKey: ["quote", id], queryFn: () => getQuote(id) });
  const { data: existingItems = [] } = useQuery({
    queryKey: ["quote-items", id],
    queryFn: () => listQuoteItems(id),
    enabled: !!q,
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
    });
  }, [q]);

  // Load extras (everything beyond position 0 = primary form line).
  useEffect(() => {
    if (itemsLoaded || existingItems.length === 0) return;
    const extras = existingItems.slice(1).map((it) => ({
      room_type: it.room_type,
      adults: it.adults,
      children: it.children,
      check_in: it.check_in,
      check_out: it.check_out,
      breakfast_included: it.breakfast_included,
      extra_bed: it.extra_bed,
      rate: Number(it.rate),
      notes: it.notes ?? null,
    }));
    setExtraItems(extras);
    setItemsLoaded(true);
  }, [existingItems, itemsLoaded]);

  const update = <K extends keyof QuoteInput>(k: K, v: QuoteInput[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const c = useMemo(() => {
    const base = calc(form);
    const extra = lineItemsTotal(extraItems);
    const subtotal = base.subtotal + extra;
    const taxes = Math.round(subtotal * TAX_RATE);
    return { ...base, subtotal, taxes, total: subtotal + taxes };
  }, [form, extraItems]);

  const save = useMutation({
    mutationFn: async () => {
      if (!form.guest_name.trim()) throw new Error("Guest name is required");
      if (!form.phone.trim()) throw new Error("Phone is required");
      if (new Date(form.check_out) <= new Date(form.check_in))
        throw new Error("Check-out must be after check-in");
      if (form.discount < 0) throw new Error("Discount cannot be negative");
      const updated = await updateQuote(id, form);
      // Replace all line items: primary (line 0) + extras
      const baseCalc = calc(form);
      const primary = {
        room_type: form.room_type,
        adults: form.adults,
        children: form.children,
        check_in: form.check_in,
        check_out: form.check_out,
        breakfast_included: form.breakfast_included,
        extra_bed: form.extra_bed,
        rate: baseCalc.room_rate,
      };
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
    return (
      <div className="p-20 flex justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-gold" />
      </div>
    );
  }

  return (
    <>
      <Topbar title="Edit Quote" subtitle={q.reference_code} />
      <div className="px-4 md:px-8 py-6 md:py-8 max-w-[1400px] pb-32 lg:pb-8">
        <Link to="/quote/$id" params={{ id }} className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-4">
          <ArrowLeft className="h-4 w-4" /> Back to quote
        </Link>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
          <div className="space-y-6">
            <Card title="Guest Details">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Guest Name" icon={User} required>
                  <input className={inputCls} value={form.guest_name} onChange={(e) => update("guest_name", e.target.value)} />
                </Field>
                <Field label="Phone" icon={Phone} required>
                  <input className={inputCls} value={form.phone} onChange={(e) => update("phone", e.target.value)} />
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
                <NumField label="Discount (₹)" value={form.discount} min={0} onChange={(v) => update("discount", v)} prefix="₹" />
              </div>
              <Field label="Internal Notes">
                <textarea rows={3} className={cn(inputCls, "resize-none mt-1")} value={form.internal_notes ?? ""} onChange={(e) => update("internal_notes", e.target.value)} />
              </Field>
            </Card>
          </div>

          <div className="hidden lg:block lg:sticky lg:top-24 self-start space-y-4">
            <LiveSummaryCard c={c} form={form} />
            <button
              onClick={() => save.mutate()}
              disabled={save.isPending}
              className="w-full inline-flex items-center justify-center gap-2 rounded-md gold-gradient px-4 py-3 text-sm font-medium text-charcoal hover:shadow-[0_0_24px_oklch(0.82_0.13_82/0.35)] transition disabled:opacity-60"
            >
              {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Save Changes
            </button>
          </div>
        </div>
      </div>

      <MobileStickySummary
        c={c}
        form={form}
        saving={save.isPending}
        primaryLabel="Save Changes"
        onPrimary={() => save.mutate()}
      />
    </>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="luxe-card rounded-xl p-5 md:p-6">
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
