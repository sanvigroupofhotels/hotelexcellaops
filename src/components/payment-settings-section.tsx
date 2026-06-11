import { motion } from "framer-motion";

export interface BookingPaymentFlags {
  allow_full_payment: boolean;
  allow_part_payment: boolean;
  allow_pay_at_hotel: boolean;
  part_payment_value: number; // percent (0-100) when type === "percent"
}

/**
 * Per-booking payment settings (overrides Global Payment Settings).
 * Same shape used in New Booking and Edit Booking — Guest Portal reads the
 * booking-level flags directly, so this is the source of truth for that booking.
 */
export function PaymentSettingsSection({
  value,
  onChange,
  hint,
}: {
  value: BookingPaymentFlags;
  onChange: (next: BookingPaymentFlags) => void;
  hint?: string;
}) {
  const update = (patch: Partial<BookingPaymentFlags>) => onChange({ ...value, ...patch });
  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="luxe-card rounded-xl p-5 md:p-6 space-y-3"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h4 className="font-display text-lg">Payment Settings</h4>
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Guest Portal</span>
      </div>
      {hint && <p className="text-[11px] text-muted-foreground -mt-1">{hint}</p>}

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
        <label className="block pl-1">
          <span className="block text-[11px] uppercase tracking-wider text-muted-foreground mb-1">
            Part Payment Percentage
          </span>
          <div className="relative max-w-[160px]">
            <input
              type="number"
              min={1}
              max={100}
              value={value.part_payment_value || 0}
              onChange={(e) => update({ part_payment_value: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })}
              className="w-full bg-input/60 border border-border rounded-md pl-3 pr-8 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gold/40 focus:border-gold/50"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">%</span>
          </div>
          <span className="block text-[10px] text-muted-foreground/70 mt-1">
            Pre-fills the part-payment amount in the Guest Portal.
          </span>
        </label>
      )}
      <ToggleRow
        label="Allow Pay At Hotel"
        sub="Guest can skip online payment and pay on arrival"
        checked={value.allow_pay_at_hotel}
        onChange={(v) => update({ allow_pay_at_hotel: v })}
      />
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
