import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PricingBreakdown } from "@/lib/pricing";

/**
 * Shared collapsible Pricing Summary used across Quote/Booking forms,
 * Booking Preview, Confirmations, and Invoices.
 *
 * Collapsed: shows only the Final Amount.
 * Expanded: Main Stay Charges → Additional Stay Charges (itemised) → Subtotal
 *           → Discount → Taxable → Tax → Final.
 */
export function PricingBreakdownCard({
  roomCharges: _roomCharges,
  extraCharges: _extraCharges,
  pricing,
  defaultOpen = true,
  title = "Pricing Summary",
  className,
  nights,
  guests,
}: {
  /** Legacy prop — kept for backwards compatibility but no longer rendered separately. */
  roomCharges?: number;
  /** Legacy prop — kept for backwards compatibility but no longer rendered separately. */
  extraCharges?: number;
  pricing: PricingBreakdown;
  defaultOpen?: boolean;
  title?: string;
  className?: string;
  nights?: number;
  guests?: number;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={cn("luxe-card rounded-xl p-5", className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between mb-2"
        aria-expanded={open}
      >
        <h4 className="font-display text-lg">{title}</h4>
        <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
          {open ? "Hide" : "Show"} breakdown
          {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </span>
      </button>

      {open && (
        <div className="space-y-3 mb-3">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
              Main Stay Charges{nights ? ` · ${nights}N` : ""}{guests ? ` · ${guests} Guests` : ""}
            </div>
            <Row label="Room Charges" value={pricing.mainStayCharges} />
          </div>

          {pricing.additionalStayCharges > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Additional Stay Charges</div>
              {pricing.additionalLineItems.map((li) => (
                <Row key={li.label} label={li.label} value={li.value} />
              ))}
            </div>
          )}

          <div className="pt-1 border-t border-border/60 space-y-0.5">
            <Row label="Subtotal" value={pricing.itemsTotal} />
            {pricing.discount > 0 && <Row label="Discount" value={-pricing.discount} />}
            <Row label="Taxable Amount" value={pricing.subtotal} />
            <Row label={`Tax (${Math.round(pricing.taxRate * 100)}%)`} value={pricing.taxes} />
          </div>
        </div>
      )}

      <div className="luxe-divider my-2" />
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium">Final Booking Amount</span>
        <span className="font-display text-2xl gold-text-gradient">
          ₹{pricing.total.toLocaleString("en-IN")}
        </span>
      </div>
    </div>
  );
}

export function PaymentSummaryCard({
  total,
  paid,
  balance,
  className,
}: {
  total: number;
  paid: number;
  balance: number;
  className?: string;
}) {
  return (
    <div className={cn("luxe-card rounded-xl p-5", className)}>
      <h4 className="font-display text-lg mb-3">Payment Summary</h4>
      <Row label="Total Booking Amount" value={total} />
      <Row label="Amount Paid" value={-Math.abs(paid)} mute={!paid} />
      <div className="luxe-divider my-2" />
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium">Balance Due</span>
        <span className="font-display text-xl text-gold">
          ₹{balance.toLocaleString("en-IN")}
        </span>
      </div>
    </div>
  );
}

function Row({ label, value, mute }: { label: string; value: number; mute?: boolean }) {
  return (
    <div className={cn("flex items-center justify-between py-1 text-sm", mute && "text-muted-foreground/60")}>
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("tabular-nums", value < 0 && "text-success")}>
        {value === 0 ? "—" : `${value < 0 ? "-" : ""}₹${Math.abs(value).toLocaleString("en-IN")}`}
      </span>
    </div>
  );
}

/**
 * Sticky pricing footer for mobile (Booking new/edit). Always renders the
 * collapsible PricingBreakdownCard above the primary action button(s).
 */
export function StickyPricingFooter({
  pricing,
  actions,
  className,
}: {
  pricing: PricingBreakdown;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 backdrop-blur shadow-lg lg:hidden",
        className,
      )}
    >
      <div className="max-w-[1400px] mx-auto p-3 space-y-2">
        <PricingBreakdownCard pricing={pricing} defaultOpen={false} className="!p-3" />
        {actions}
      </div>
    </div>
  );
}
