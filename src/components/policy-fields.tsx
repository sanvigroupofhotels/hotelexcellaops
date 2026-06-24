import { useState } from "react";
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
import { Switch } from "@/components/ui/switch";
import { Coffee, UserPlus, Car, PawPrint, ChevronDown, ChevronUp } from "lucide-react";
import { useOpsTimeLabels } from "@/lib/check-times";

const inputCls =
  "w-full bg-input/60 border border-border rounded-md px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-gold/40 focus:border-gold/50 transition";

export function PolicyFields({
  form,
  update,
  apply,
}: {
  form: QuoteInput;
  update: <K extends keyof QuoteInput>(k: K, v: QuoteInput[K]) => void;
  /** Atomic multi-field write. Falls back to sequential `update` calls if absent. */
  apply?: (patch: Partial<QuoteInput>) => void;
}) {
  // Paired-field commits MUST go through `apply` so React's single render uses
  // the merged patch — sequential `update(k,v)` calls share a stale closure and
  // the last write wins, which is why Early/Late/Pet were "not selectable".
  const applyMany = (patch: Partial<QuoteInput>) => {
    if (apply) { apply(patch); return; }
    for (const [k, v] of Object.entries(patch)) (update as any)(k, v);
  };
  const anyExtra =
    form.early_check_in ||
    form.late_check_out ||
    (form.pet_size && form.pet_size !== "none") ||
    (form.extra_adults ?? 0) > 0 ||
    (form.drivers ?? 0) > 0;
  // UX: Most bookings don't use extras — start collapsed.
  // Auto-open if any extra is already selected so existing data isn't hidden.
  const [extrasOpen, setExtrasOpen] = useState<boolean>(!!anyExtra);
  const checkTimes = useOpsTimeLabels();

  return (
    <div className="space-y-4">
      {/* 1. Breakfast Included */}
      <div className="rounded-md bg-secondary/40 border border-border p-3">
        <ToggleRow
          icon={<Coffee className="h-4 w-4 text-gold" />}
          label="Breakfast Included"
          checked={form.breakfast_included}
          onChange={(v) => update("breakfast_included", v)}
        />
      </div>

      {/* 2. Extra Breakfast — independent, always visible */}
      <div className="rounded-md bg-secondary/40 border border-border p-3">
        <StepperRow
          label={`Extra Breakfast Guests (₹${EXTRA_BREAKFAST_RATE}/head/night)`}
          help="Independent of Breakfast Included"
          value={form.extra_breakfast_guests}
          onChange={(v) => update("extra_breakfast_guests", v)}
        />
      </div>

      {/* 3. Collapsible Extras (Early / Late / Pet / Extra Adults / Drivers) */}
      <button
        type="button"
        onClick={() => setExtrasOpen((v) => !v)}
        className="w-full inline-flex items-center justify-between rounded-md border border-border bg-card/60 px-3 py-2.5 text-xs text-muted-foreground hover:text-foreground hover:border-gold/30 transition"
      >
        <span>Extras (Early / Late / Pet / Extra Adults / Drivers){anyExtra ? " · active" : ""}</span>
        {extrasOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      </button>

      {extrasOpen && (
        <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          <SlotPicker
            icon="🌅"
            title="Early Check-in"
            subtitle={`Standard ${checkTimes.checkIn} · Subject to availability`}
            options={EARLY_CHECK_IN_SLOTS.map((s) => ({ value: s.value, label: s.label, fee: s.fee }))}
            active={form.early_check_in}
            selectedValue={form.early_check_in_slot}
            onSelect={(val) => {
              if (val === null) {
                applyMany({ early_check_in: false, early_check_in_slot: null });
              } else {
                applyMany({ early_check_in: true, early_check_in_slot: val as EarlyCheckInSlot });
              }
            }}
          />

          <SlotPicker
            icon="🌙"
            title="Late Check-out"
            subtitle={`Standard ${checkTimes.checkOut} · Subject to availability`}
            options={LATE_CHECK_OUT_SLOTS.map((s) => ({ value: s.value, label: s.label, fee: s.fee }))}
            active={form.late_check_out}
            selectedValue={form.late_check_out_slot}
            onSelect={(val) => {
              if (val === null) {
                applyMany({ late_check_out: false, late_check_out_slot: null });
              } else {
                applyMany({ late_check_out: true, late_check_out_slot: val as LateCheckOutSlot });
              }
            }}
          />

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
                    applyMany({
                      pet_size: p.value as PetSize,
                      pet_charges: p.value !== "none",
                    });
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

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <StepperRow
              icon={<UserPlus className="h-3.5 w-3.5 text-gold" />}
              label={`Extra Adults (₹${EXTRA_ADULT_RATE}/night)`}
              help="Includes Extra Mattress"
              value={form.extra_adults}
              onChange={(v) => update("extra_adults", v)}
            />
            <StepperRow
              icon={<Car className="h-3.5 w-3.5 text-gold" />}
              label={`Drivers (₹${DRIVER_RATE}/night)`}
              help="Includes Extra Mattress"
              value={form.drivers}
              onChange={(v) => update("drivers", v)}
            />
          </div>
        </motion.div>
      )}
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
    <div className="flex items-center justify-between">
      <span className="text-sm flex items-center gap-2">
        {icon && <span className="inline-flex items-center">{icon}</span>}
        {label}
      </span>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
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
