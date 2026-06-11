import { NumField } from "@/components/num-field";

/**
 * Reusable Total Override + Taxes Included card.
 * Mirrors the Bookings override behaviour for Quotes.
 */
export function OverrideCard({
  totalOverride,
  taxesIncluded,
  computedTotal,
  onChange,
}: {
  totalOverride: number | null;
  taxesIncluded: boolean;
  computedTotal: number;
  onChange: (totalOverride: number | null, taxesIncluded: boolean) => void;
}) {
  const active = totalOverride !== null;
  return (
    <div className="luxe-card rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="font-display text-sm">Total Override</h4>
        <label className="inline-flex items-center gap-2 text-[11px] text-muted-foreground">
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => onChange(e.target.checked ? computedTotal : null, taxesIncluded)}
          />
          <span>Override total</span>
        </label>
      </div>
      {active && (
        <>
          <NumField
            label="Total Amount (₹)"
            value={totalOverride ?? 0}
            onChange={(n) => onChange(Number.isFinite(n) ? n : 0, taxesIncluded)}
            min={0}
            decimal
            prefix="₹"
          />
          <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={taxesIncluded}
              onChange={(e) => onChange(totalOverride, e.target.checked)}
            />
            <span>Taxes Included in Total</span>
          </label>
          <p className="text-[10px] text-muted-foreground/80 leading-relaxed">
            When enabled, the entered amount is treated as gross (tax-inclusive). Otherwise, tax is added on top.
          </p>
        </>
      )}
    </div>
  );
}
