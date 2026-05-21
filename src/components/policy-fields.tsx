import { motion } from "framer-motion";
import {
  EARLY_CHECK_IN_SLOTS,
  LATE_CHECK_OUT_SLOTS,
  EXTRA_ADULT_RATE,
  DRIVER_RATE,
  EXTRA_BREAKFAST_RATE,
  type EarlyCheckInSlot,
  type LateCheckOutSlot,
} from "@/lib/mock-data";
import type { QuoteInput } from "@/lib/quotes-api";
import { cn } from "@/lib/utils";
import { Coffee, UserPlus, Car } from "lucide-react";

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
    <div className="space-y-3">
      {/* Early check-in */}
      <ToggleRow
        icon="🌅"
        label="Early Check-in (after 1 PM standard)"
        checked={form.early_check_in}
        onChange={(v) => {
          update("early_check_in", v);
          if (!v) update("early_check_in_slot", null);
          else if (!form.early_check_in_slot)
            update("early_check_in_slot", "10-13" as EarlyCheckInSlot);
        }}
      />
      {form.early_check_in && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="pl-2"
        >
          <select
            className={inputCls}
            value={form.early_check_in_slot ?? ""}
            onChange={(e) =>
              update("early_check_in_slot", e.target.value as EarlyCheckInSlot)
            }
          >
            {EARLY_CHECK_IN_SLOTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label} — {s.fee === null ? "Full day room charge" : `₹${s.fee}`}
              </option>
            ))}
          </select>
          <p className="text-[10px] text-muted-foreground mt-1">
            Subject to availability. Standard check-in 1:00 PM.
          </p>
        </motion.div>
      )}

      {/* Late check-out */}
      <ToggleRow
        icon="🌙"
        label="Late Check-out (after 11 AM standard)"
        checked={form.late_check_out}
        onChange={(v) => {
          update("late_check_out", v);
          if (!v) update("late_check_out_slot", null);
          else if (!form.late_check_out_slot)
            update("late_check_out_slot", "upto-2pm" as LateCheckOutSlot);
        }}
      />
      {form.late_check_out && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="pl-2"
        >
          <select
            className={inputCls}
            value={form.late_check_out_slot ?? ""}
            onChange={(e) =>
              update("late_check_out_slot", e.target.value as LateCheckOutSlot)
            }
          >
            {LATE_CHECK_OUT_SLOTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label} — {s.fee === null ? "Full day room charge" : `₹${s.fee}`}
              </option>
            ))}
          </select>
          <p className="text-[10px] text-muted-foreground mt-1">
            Subject to availability. Standard check-out 11:00 AM.
          </p>
        </motion.div>
      )}

      <ToggleRow
        icon="🐾"
        label="Pet Charges (₹1000)"
        checked={form.pet_charges}
        onChange={(v) => update("pet_charges", v)}
      />

      {/* Extra adults & drivers */}
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

      {/* Breakfast */}
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
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <StepperRow
              label={`Extra Breakfast Guests (₹${EXTRA_BREAKFAST_RATE}/head/night)`}
              help="For bookings without breakfast"
              value={form.extra_breakfast_guests}
              onChange={(v) => update("extra_breakfast_guests", v)}
            />
          </motion.div>
        )}
      </div>
    </div>
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
  icon,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between rounded-md bg-secondary/40 border border-border px-3 py-2.5">
      <span className="text-sm flex items-center gap-2">
        {icon && <span className="inline-flex items-center">{icon}</span>}
        {label}
      </span>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={cn(
          "relative h-5 w-9 rounded-full transition",
          checked ? "gold-gradient" : "bg-muted",
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

function StepperRow({
  label,
  help,
  icon,
  value,
  onChange,
}: {
  label: string;
  help?: string;
  icon?: React.ReactNode;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="rounded-md bg-secondary/40 border border-border px-3 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm flex items-center gap-1.5">
            {icon}
            <span className="truncate">{label}</span>
          </div>
          {help && (
            <p className="text-[10px] text-muted-foreground mt-0.5">{help}</p>
          )}
        </div>
        <div className="flex items-center bg-input/60 border border-border rounded-md overflow-hidden shrink-0">
          <button
            type="button"
            onClick={() => onChange(Math.max(0, value - 1))}
            className="px-2.5 py-1.5 hover:bg-secondary text-muted-foreground hover:text-foreground"
          >
            −
          </button>
          <div className="w-8 text-center text-sm tabular-nums">{value}</div>
          <button
            type="button"
            onClick={() => onChange(value + 1)}
            className="px-2.5 py-1.5 hover:bg-secondary text-muted-foreground hover:text-foreground"
          >
            +
          </button>
        </div>
      </div>
    </div>
  );
}

export function SummaryExtras({
  c,
  form,
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
