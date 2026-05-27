import { motion } from "framer-motion";
import {
  EARLY_CHECK_IN_SLOTS,
  LATE_CHECK_OUT_SLOTS,
  EXTRA_ADULT_RATE,
  DRIVER_RATE,
  EXTRA_BREAKFAST_RATE,
  PET_OPTIONS,
  type EarlyCheckInSlot,
  type LateCheckOutSlot,
  type PetSize,
} from "@/lib/mock-data";
import type { QuoteInput } from "@/lib/quotes-api";
import { cn } from "@/lib/utils";
import { Coffee, UserPlus, Car, PawPrint } from "lucide-react";

const inputCls =
  "w-full bg-input/60 border border-border rounded-md px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-gold/40 focus:border-gold/50 transition";

export function PolicyFields({
  form,
  update,
}: {
  form: QuoteInput;
  update: <K extends keyof QuoteInput>(k: K, v: QuoteInput[K]) => void;
}) {
  return (
    <div className="space-y-4">
      {/* Early Check-in — card UX */}
      <SlotPicker
        icon="🌅"
        title="Early Check-in"
        subtitle="Standard 1:00 PM · Subject to availability"
        options={EARLY_CHECK_IN_SLOTS.map((s) => ({ value: s.value, label: s.label, fee: s.fee }))}
        active={form.early_check_in}
        selectedValue={form.early_check_in_slot}
        onSelect={(val) => {
          if (val === null) {
            update("early_check_in", false);
            update("early_check_in_slot", null);
          } else {
            update("early_check_in", true);
            update("early_check_in_slot", val as EarlyCheckInSlot);
          }
        }}
      />

      {/* Late Check-out — card UX */}
      <SlotPicker
        icon="🌙"
        title="Late Check-out"
        subtitle="Standard 11:00 AM · Subject to availability"
        options={LATE_CHECK_OUT_SLOTS.map((s) => ({ value: s.value, label: s.label, fee: s.fee }))}
        active={form.late_check_out}
        selectedValue={form.late_check_out_slot}
        onSelect={(val) => {
          if (val === null) {
            update("late_check_out", false);
            update("late_check_out_slot", null);
          } else {
            update("late_check_out", true);
            update("late_check_out_slot", val as LateCheckOutSlot);
          }
        }}
      />

      {/* Pet size selector (replaces simple pet toggle) */}
      <div className="rounded-md bg-secondary/40 border border-border p-3">
        <div className="flex items-center gap-2 mb-2">
          <PawPrint className="h-4 w-4 text-gold" />
          <span className="text-sm">Pet</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {PET_OPTIONS.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => {
                update("pet_size", p.value as PetSize);
                update("pet_charges", p.value !== "none");
              }}
              className={cn(
                "rounded-md border px-2 py-2 text-xs transition text-left",
                form.pet_size === p.value
                  ? "border-gold/60 bg-gold-soft text-gold"
                  : "border-border bg-input/40 text-muted-foreground hover:text-foreground hover:border-gold/30",
              )}
            >
              <div className="font-medium">{p.label}</div>
              <div className="text-[10px] opacity-80">{p.fee ? `₹${p.fee}/night` : "—"}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
        <StepperRow
          icon={<UserPlus className="h-3.5 w-3.5 text-gold" />}
          label={`Extra Adults (₹${EXTRA_ADULT_RATE}/night)`}
          help="Includes extra mattress & breakfast"
          value={form.extra_adults}
          onChange={(v) => update("extra_adults", v)}
        />
        <StepperRow
          icon={<Car className="h-3.5 w-3.5 text-gold" />}
          label={`Drivers (₹${DRIVER_RATE}/night)`}
          help="Includes mattress & breakfast"
          value={form.drivers}
          onChange={(v) => update("drivers", v)}
        />
      </div>

      <div className="rounded-md bg-secondary/40 border border-border p-3 space-y-3">
        <ToggleRow
          icon={<Coffee className="h-4 w-4 text-gold" />}
          label="Breakfast Included"
          checked={form.breakfast_included}
          onChange={(v) => {
            update("breakfast_included", v);
            if (v) update("extra_breakfast_guests", 0);
          }}
        />
        {!form.breakfast_included && (
          <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}>
            <StepperRow
              label={`Extra Breakfast Guests (₹${EXTRA_BREAKFAST_RATE}/head/night)`}
              help="Only when breakfast not included in tariff"
              value={form.extra_breakfast_guests}
              onChange={(v) => update("extra_breakfast_guests", v)}
            />
          </motion.div>
        )}
      </div>
    </div>
  );
}

interface SlotOpt { value: string; label: string; fee: number | null }
function SlotPicker({
  icon, title, subtitle, options, active, selectedValue, onSelect,
}: {
  icon?: React.ReactNode;
  title: string;
  subtitle?: string;
  options: SlotOpt[];
  active: boolean;
  selectedValue: string | null | undefined;
  onSelect: (val: string | null) => void;
}) {
  return (
    <div className="rounded-md bg-secondary/40 border border-border p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          {icon && <span className="text-base">{icon}</span>}
          <div>
            <div className="text-sm font-medium">{title}</div>
            {subtitle && <div className="text-[10px] text-muted-foreground">{subtitle}</div>}
          </div>
        </div>
        {active && (
          <button
            type="button"
            onClick={() => onSelect(null)}
            className="text-[10px] uppercase tracking-wider text-muted-foreground hover:text-gold transition"
          >
            Clear
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {options.map((o) => {
          const selected = active && selectedValue === o.value;
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => onSelect(selected ? null : o.value)}
              className={cn(
                "rounded-md border px-2.5 py-2.5 text-left transition",
                selected
                  ? "border-gold/60 bg-gold-soft text-gold shadow-[0_0_12px_oklch(0.82_0.13_82/0.25)]"
                  : "border-border bg-input/40 text-muted-foreground hover:text-foreground hover:border-gold/30",
              )}
            >
              <div className="text-xs font-medium leading-tight">{o.label}</div>
              <div className="text-[10px] mt-1 opacity-80">
                {o.fee === null ? "Full day charge" : `₹${o.fee}`}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ToggleRow({
  label, checked, onChange, icon,
}: { label: string; checked: boolean; onChange: (v: boolean) => void; icon?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between rounded-md bg-secondary/40 border border-border px-3 py-2.5">
      <span className="text-sm flex items-center gap-2">
        {icon && <span className="inline-flex items-center">{icon}</span>}
        {label}
      </span>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        aria-pressed={checked}
        className={cn(
          "relative h-6 w-11 rounded-full transition border-2",
          checked
            ? "bg-foreground/80 border-foreground"
            : "bg-muted border-foreground/50",
        )}
      >
        <motion.span
          animate={{ x: checked ? 22 : 2 }}
          transition={{ type: "spring", stiffness: 500, damping: 30 }}
          className="absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-md"
        />
      </button>
    </div>
  );
}

function StepperRow({
  label, help, icon, value, onChange,
}: { label: string; help?: string; icon?: React.ReactNode; value: number; onChange: (v: number) => void }) {
  return (
    <div className="rounded-md bg-secondary/40 border border-border px-3 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm flex items-center gap-1.5">
            {icon}
            <span className="truncate">{label}</span>
          </div>
          {help && <p className="text-[10px] text-muted-foreground mt-0.5">{help}</p>}
        </div>
        <div className="flex items-center bg-input/60 border border-border rounded-md overflow-hidden shrink-0">
          <button
            type="button"
            onClick={() => onChange(Math.max(0, value - 1))}
            className="px-2.5 py-1.5 hover:bg-secondary text-muted-foreground hover:text-foreground"
          >−</button>
          <div className="w-8 text-center text-sm tabular-nums">{value}</div>
          <button
            type="button"
            onClick={() => onChange(value + 1)}
            className="px-2.5 py-1.5 hover:bg-secondary text-muted-foreground hover:text-foreground"
          >+</button>
        </div>
      </div>
    </div>
  );
}

export function SummaryExtras({
  c, form,
}: {
  c: ReturnType<typeof import("@/lib/quotes-api").calc>;
  form: QuoteInput;
}) {
  return (
    <>
      {c.extraAdults > 0 && <Row label={`Extra Adults × ${form.extra_adults}`} value={c.extraAdults} />}
      {c.driversCharge > 0 && <Row label={`Drivers × ${form.drivers}`} value={c.driversCharge} />}
      {c.extraBreakfast > 0 && (
        <Row label={`Extra Breakfast × ${form.extra_breakfast_guests}`} value={c.extraBreakfast} />
      )}
      {!form.breakfast_included && c.extraBreakfast === 0 && (
        <div className="flex items-center justify-between py-1.5 text-xs text-muted-foreground/70 italic">
          <span>Breakfast not included</span>
        </div>
      )}
    </>
  );
}
function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between py-1.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums">₹{value.toLocaleString("en-IN")}</span>
    </div>
  );
}
