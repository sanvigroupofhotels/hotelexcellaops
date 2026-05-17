import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Topbar } from "@/components/topbar";
import { roomTypes } from "@/lib/mock-data";
import {
  User, Phone, Mail, Users, CalendarDays, Bed, Plus, Minus,
  ArrowLeft, Download, MessageCircle, Sparkles, Wifi, Coffee, Heart, Headphones, Star,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/generate")({
  component: GenerateQuote,
});

const TAX_RATE = 0.12;

function Field({ label, icon: Icon, children, required }: { label: string; icon?: any; children: React.ReactNode; required?: boolean }) {
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

const inputCls =
  "w-full bg-input/60 border border-border rounded-md px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-gold/40 focus:border-gold/50 transition";

function GenerateQuote() {
  const [step, setStep] = useState<"edit" | "preview">("edit");
  const [form, setForm] = useState({
    guestName: "Rohit Sharma",
    phone: "+91 98765 43210",
    email: "rohit.sharma@email.com",
    leadSource: "Direct",
    groupSize: "2 Adults",
    specialRequests: "High floor, quiet room",
    checkIn: "2025-05-25",
    checkOut: "2025-05-27",
    roomType: roomTypes[0].name,
    rooms: 1,
    extraBed: 0,
    earlyCheckIn: false,
    lateCheckOut: true,
    petCharges: false,
    discount: 500,
    notes: "Follow up after 2 days",
  });

  const update = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  const calc = useMemo(() => {
    const nights = Math.max(
      1,
      Math.round((new Date(form.checkOut).getTime() - new Date(form.checkIn).getTime()) / 86400000)
    );
    const room = roomTypes.find((r) => r.name === form.roomType) ?? roomTypes[0];
    const roomTariff = room.rate * nights * form.rooms;
    const extraBed = form.extraBed * 500 * nights;
    const earlyCheck = form.earlyCheckIn ? 500 : 0;
    const lateCheck = form.lateCheckOut ? 500 : 0;
    const pet = form.petCharges ? 1000 : 0;
    const subtotal = roomTariff + extraBed + earlyCheck + lateCheck + pet - form.discount;
    const taxes = Math.round(subtotal * TAX_RATE);
    const total = subtotal + taxes;
    return { nights, room, roomTariff, extraBed, earlyCheck, lateCheck, pet, subtotal, taxes, total };
  }, [form]);

  return (
    <>
      <Topbar title="Generate Quote" subtitle="Build a tailored stay proposal in seconds" />
      <div className="px-4 md:px-8 py-6 md:py-8 max-w-[1400px]">
        <AnimatePresence mode="wait">
          {step === "edit" ? (
            <motion.div
              key="edit"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.3 }}
              className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6"
            >
              {/* Form */}
              <div className="space-y-6">
                <Card title="Guest Details">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Field label="Guest Name" icon={User} required>
                      <input className={inputCls} value={form.guestName} onChange={(e) => update("guestName", e.target.value)} />
                    </Field>
                    <Field label="Phone" icon={Phone} required>
                      <input className={inputCls} value={form.phone} onChange={(e) => update("phone", e.target.value)} />
                    </Field>
                    <Field label="Email" icon={Mail}>
                      <input className={inputCls} value={form.email} onChange={(e) => update("email", e.target.value)} />
                    </Field>
                    <Field label="Lead Source">
                      <select className={inputCls} value={form.leadSource} onChange={(e) => update("leadSource", e.target.value)}>
                        {["Direct", "Website", "WhatsApp", "Referral", "OTA"].map((o) => <option key={o}>{o}</option>)}
                      </select>
                    </Field>
                    <Field label="Group Size" icon={Users}>
                      <select className={inputCls} value={form.groupSize} onChange={(e) => update("groupSize", e.target.value)}>
                        {["1 Adult", "2 Adults", "2 Adults + 1 Child", "Family of 4"].map((o) => <option key={o}>{o}</option>)}
                      </select>
                    </Field>
                    <Field label="Special Requests">
                      <input className={inputCls} value={form.specialRequests} onChange={(e) => update("specialRequests", e.target.value)} />
                    </Field>
                  </div>
                </Card>

                <Card title="Stay Details">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Field label="Check-in" icon={CalendarDays} required>
                      <input type="date" className={inputCls} value={form.checkIn} onChange={(e) => update("checkIn", e.target.value)} />
                    </Field>
                    <Field label="Check-out" icon={CalendarDays} required>
                      <input type="date" className={inputCls} value={form.checkOut} onChange={(e) => update("checkOut", e.target.value)} />
                    </Field>
                  </div>
                  <div className="mt-2 text-right text-xs text-gold">{calc.nights} Night{calc.nights > 1 ? "s" : ""}</div>
                </Card>

                <Card title="Room & Extras">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Field label="Room Type" icon={Bed}>
                      <select className={inputCls} value={form.roomType} onChange={(e) => update("roomType", e.target.value)}>
                        {roomTypes.map((r) => <option key={r.name}>{r.name}</option>)}
                      </select>
                    </Field>
                    <Field label="Rooms">
                      <Stepper value={form.rooms} min={1} onChange={(v) => update("rooms", v)} />
                    </Field>
                    <Field label="Extra Bed">
                      <Stepper value={form.extraBed} min={0} onChange={(v) => update("extraBed", v)} />
                    </Field>
                    <div />
                  </div>
                  <div className="mt-4 space-y-2">
                    <ToggleRow label="Early Check-in (₹500)" checked={form.earlyCheckIn} onChange={(v) => update("earlyCheckIn", v)} icon="🌅" />
                    <ToggleRow label="Late Check-out (₹500)" checked={form.lateCheckOut} onChange={(v) => update("lateCheckOut", v)} icon="🌙" />
                    <ToggleRow label="Pet Charges (₹1000)" checked={form.petCharges} onChange={(v) => update("petCharges", v)} icon="🐾" />
                  </div>
                </Card>

                <Card title="Additional">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Field label="Discount (₹)">
                      <input type="number" className={inputCls} value={form.discount} onChange={(e) => update("discount", Number(e.target.value))} />
                    </Field>
                  </div>
                  <Field label="Internal Notes">
                    <textarea rows={3} className={cn(inputCls, "resize-none mt-1")} value={form.notes} onChange={(e) => update("notes", e.target.value)} />
                  </Field>
                </Card>
              </div>

              {/* Live Summary */}
              <div className="lg:sticky lg:top-24 self-start space-y-4">
                <div className="luxe-card rounded-xl p-5">
                  <div className="flex items-center justify-between mb-4">
                    <h4 className="font-display text-lg">Live Summary</h4>
                    <Sparkles className="h-4 w-4 text-gold" />
                  </div>
                  <SummaryRow label={`Room Tariff (${calc.nights} Night${calc.nights > 1 ? "s" : ""})`} value={calc.roomTariff} />
                  <SummaryRow label="Extra Bed" value={calc.extraBed} mute={calc.extraBed === 0} />
                  <SummaryRow label="Early Check-in" value={calc.earlyCheck} mute={!calc.earlyCheck} />
                  <SummaryRow label="Late Check-out" value={calc.lateCheck} mute={!calc.lateCheck} />
                  <SummaryRow label="Pet Charges" value={calc.pet} mute={!calc.pet} />
                  {form.discount > 0 && <SummaryRow label="Discount" value={-form.discount} />}
                  <div className="luxe-divider my-3" />
                  <SummaryRow label="Subtotal" value={calc.subtotal - calc.taxes + calc.taxes - calc.taxes} />
                  <SummaryRow label="Taxes & Fees" value={calc.taxes} />
                  <div className="mt-4 rounded-lg bg-gold-soft border border-gold/30 p-4">
                    <div className="flex items-baseline justify-between">
                      <span className="text-sm text-gold/90">Total Amount</span>
                      <span className="font-display text-2xl text-gold">₹{calc.total.toLocaleString("en-IN")}</span>
                    </div>
                    <p className="text-[10px] text-gold/70 mt-1">Including all taxes</p>
                  </div>
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() => setForm({ ...form, discount: 0, earlyCheckIn: false, lateCheckOut: false, petCharges: false })}
                    className="flex-1 rounded-md border border-border bg-card px-4 py-2.5 text-sm hover:border-gold/40 transition"
                  >
                    Reset
                  </button>
                  <button
                    onClick={() => setStep("preview")}
                    className="flex-1 rounded-md gold-gradient px-4 py-2.5 text-sm font-medium text-charcoal hover:shadow-[0_0_24px_oklch(0.82_0.13_82/0.35)] transition"
                  >
                    Preview Quote →
                  </button>
                </div>
              </div>

              {/* Mobile sticky CTA */}
              <div className="lg:hidden fixed bottom-0 inset-x-0 z-30 p-4 bg-background/90 backdrop-blur-lg border-t border-border">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-muted-foreground">Total</span>
                  <span className="font-display text-lg text-gold">₹{calc.total.toLocaleString("en-IN")}</span>
                </div>
                <button onClick={() => setStep("preview")} className="w-full rounded-md gold-gradient px-4 py-3 text-sm font-medium text-charcoal">
                  Preview Quote →
                </button>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="preview"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.3 }}
              className="space-y-4"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <button onClick={() => setStep("edit")} className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition">
                  <ArrowLeft className="h-4 w-4" /> Back to Edit
                </button>
                <div className="flex gap-2">
                  <button onClick={() => toast.success("PDF downloaded")} className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-4 py-2.5 text-sm hover:border-gold/40 transition">
                    <Download className="h-4 w-4 text-gold" /> Download PDF
                  </button>
                  <button onClick={() => toast.success("Sent via WhatsApp")} className="inline-flex items-center gap-2 rounded-md bg-success/15 border border-success/40 text-success px-4 py-2.5 text-sm hover:bg-success/20 transition">
                    <MessageCircle className="h-4 w-4" /> Send via WhatsApp
                  </button>
                </div>
              </div>

              <QuotePreview form={form} calc={calc} />
            </motion.div>
          )}
        </AnimatePresence>
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

function ToggleRow({ label, checked, onChange, icon }: { label: string; checked: boolean; onChange: (v: boolean) => void; icon?: string }) {
  return (
    <div className="flex items-center justify-between rounded-md bg-secondary/40 border border-border px-3 py-2.5">
      <span className="text-sm flex items-center gap-2">
        {icon && <span className="text-base">{icon}</span>}
        {label}
      </span>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={cn(
          "relative h-5 w-9 rounded-full transition",
          checked ? "gold-gradient" : "bg-muted"
        )}
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

function QuotePreview({ form, calc }: { form: any; calc: any }) {
  const includes = [
    { icon: Wifi, label: "Complimentary WiFi" },
    { icon: Coffee, label: "Daily Housekeeping" },
    { icon: Heart, label: "Welcome Amenities" },
    { icon: Headphones, label: "24/7 Support" },
  ];
  return (
    <div className="luxe-card rounded-2xl p-6 md:p-10 relative overflow-hidden">
      <div className="absolute -right-32 -top-32 h-80 w-80 rounded-full bg-gold/5 blur-3xl pointer-events-none" />

      <div className="relative flex flex-col md:flex-row md:items-start md:justify-between gap-4 pb-6 border-b border-border">
        <div className="flex items-center gap-4">
          <div className="h-14 w-14 rounded-md gold-gradient flex items-center justify-center">
            <span className="font-display text-2xl font-semibold text-charcoal">H</span>
          </div>
          <div>
            <div className="font-display text-xl">HOTEL EXCELLA</div>
            <div className="text-[10px] tracking-[0.3em] text-gold/80 uppercase">Boutique · Luxury · Stay</div>
          </div>
        </div>
        <div className="text-right">
          <h2 className="font-display text-4xl gold-text-gradient">QUOTE</h2>
          <div className="text-xs text-muted-foreground mt-1">HEX-{new Date().toISOString().slice(2, 10).replace(/-/g, "")}-001</div>
          <div className="text-[10px] text-muted-foreground mt-0.5">Valid till: 31 May 2025</div>
        </div>
      </div>

      <div className="relative grid grid-cols-1 md:grid-cols-2 gap-6 py-6 border-b border-border">
        <div>
          <h4 className="text-[10px] uppercase tracking-[0.25em] text-gold mb-3">Guest Details</h4>
          <div className="space-y-1.5 text-sm">
            <div className="flex items-center gap-2"><User className="h-3.5 w-3.5 text-muted-foreground" />{form.guestName}</div>
            <div className="flex items-center gap-2"><Phone className="h-3.5 w-3.5 text-muted-foreground" />{form.phone}</div>
            <div className="flex items-center gap-2"><Mail className="h-3.5 w-3.5 text-muted-foreground" />{form.email}</div>
          </div>
        </div>
        <div>
          <h4 className="text-[10px] uppercase tracking-[0.25em] text-gold mb-3">Stay Details</h4>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <div className="flex items-center gap-1.5"><CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />{new Date(form.checkIn).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">Check-in</div>
            </div>
            <div>
              <div className="flex items-center gap-1.5"><CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />{new Date(form.checkOut).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">Check-out</div>
            </div>
            <div className="col-span-2 text-xs text-muted-foreground">{form.groupSize} · {calc.nights} Night{calc.nights > 1 ? "s" : ""}</div>
          </div>
        </div>
      </div>

      <div className="relative py-6 border-b border-border">
        <div className="grid grid-cols-[1fr_auto] gap-2 text-[10px] uppercase tracking-[0.25em] text-muted-foreground pb-3">
          <div>Description</div>
          <div>Amount</div>
        </div>
        <Row desc={`${calc.room.name} × ${form.rooms} room (${calc.nights} Night${calc.nights > 1 ? "s" : ""})`} amount={calc.roomTariff} />
        {calc.extraBed > 0 && <Row desc="Extra Bed" amount={calc.extraBed} />}
        {calc.earlyCheck > 0 && <Row desc="Early Check-in" amount={calc.earlyCheck} />}
        {calc.lateCheck > 0 && <Row desc="Late Check-out" amount={calc.lateCheck} />}
        {calc.pet > 0 && <Row desc="Pet Charges" amount={calc.pet} />}
        {form.discount > 0 && <Row desc="Discount" amount={-form.discount} />}
        <Row desc="Taxes & Fees" amount={calc.taxes} />
      </div>

      <div className="relative py-6 border-b border-border flex items-baseline justify-between">
        <span className="font-display text-2xl">Total Amount</span>
        <span className="font-display text-3xl gold-text-gradient">₹{calc.total.toLocaleString("en-IN")}</span>
      </div>

      <div className="relative py-6">
        <h4 className="text-[10px] uppercase tracking-[0.25em] text-gold mb-3">Includes</h4>
        <div className="flex flex-wrap gap-2">
          {includes.map((i) => {
            const Icon = i.icon;
            return (
              <span key={i.label} className="inline-flex items-center gap-1.5 rounded-full bg-secondary border border-border px-3 py-1.5 text-xs">
                <Icon className="h-3 w-3 text-gold" /> {i.label}
              </span>
            );
          })}
        </div>
      </div>

      <div className="relative pt-6 border-t border-border text-center">
        <p className="font-display italic text-lg text-gold/90">We look forward to hosting you at Hotel Excella</p>
        <div className="flex justify-center gap-1 mt-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Star key={i} className="h-4 w-4 fill-gold text-gold" />
          ))}
        </div>
      </div>
    </div>
  );
}

function Row({ desc, amount }: { desc: string; amount: number }) {
  return (
    <div className="grid grid-cols-[1fr_auto] gap-2 py-2 text-sm border-t border-border/40 first:border-0">
      <div>{desc}</div>
      <div className={cn("tabular-nums", amount < 0 && "text-success")}>
        {amount < 0 ? "-" : ""}₹{Math.abs(amount).toLocaleString("en-IN")}
      </div>
    </div>
  );
}
