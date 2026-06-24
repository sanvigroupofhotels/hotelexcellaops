import { motion } from "framer-motion";
import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { NumField } from "@/components/num-field";


export interface BookingPaymentFlags {
  allow_full_payment: boolean;
  allow_part_payment: boolean;
  allow_pay_at_hotel: boolean;
  part_payment_value: number; // percent (0-100) when type === "percent"
}

/**
 * Per-booking payment settings (overrides Global Payment Settings).
 * Collapsed by default — most receptionists never need to touch this.
 */
export function PaymentSettingsSection({
  value,
  onChange,
  hint,
  defaultOpen = false,
}: {
  value: BookingPaymentFlags;
  onChange: (next: BookingPaymentFlags) => void;
  hint?: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const update = (patch: Partial<BookingPaymentFlags>) => onChange({ ...value, ...patch });
  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="luxe-card rounded-xl"
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-3 p-5 md:p-6 text-left"
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="font-display text-lg">Guest Portal Overrides</h4>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Optional</span>
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {hint ?? "Override global payment settings for this booking only."}
          </p>
        </div>
        {open ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
      </button>
      {open && (
        <div className="px-5 md:px-6 pb-5 md:pb-6 space-y-3">
          <ToggleRow
            label="Allow Full Payment"
            sub="Guest can pay the full balance via Razorpay"
            checked={value.allow_full_payment}
            onChange={(v) => update({ allow_full_payment: v })}
          />
          <ToggleRow
            label="Allow Part Payment"
            sub="Guest can pay a partial advance via Razorpay"
            checked={value.allow_part_payment}
            onChange={(v) => update({ allow_part_payment: v })}
          />
          {value.allow_part_payment && (
            <div className="pl-1 max-w-[200px]">
              <NumField
                label="Part Payment Percentage"
                value={value.part_payment_value || 0}
                min={0}
                decimal
                onChange={(v) => update({ part_payment_value: Math.min(100, v) })}
                hint="Pre-fills the part-payment amount in the Guest Portal."
              />
            </div>
          )}
          <ToggleRow
            label="Allow Pay At Hotel"
            sub="Guest can skip online payment and pay on arrival"
            checked={value.allow_pay_at_hotel}
            onChange={(v) => update({ allow_pay_at_hotel: v })}
          />
        </div>
      )}
    </motion.section>
  );
}

function ToggleRow({
  label,
  sub,
  checked,
  onChange,
}: {
  label: string;
  sub?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-start justify-between gap-3 cursor-pointer py-1">
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
      </div>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 h-4 w-4 accent-gold shrink-0"
      />
    </label>
  );
}
