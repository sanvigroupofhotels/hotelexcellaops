import { useState } from "react";
import { Sparkles, Loader2, Save, ChevronUp, ChevronDown } from "lucide-react";
import { SummaryExtras } from "@/components/policy-fields";
import type { QuoteInput } from "@/lib/quotes-api";
import { calc } from "@/lib/quotes-api";
import { cn } from "@/lib/utils";

type Calc = ReturnType<typeof calc>;

/**
 * Desktop live-summary card (used in right rail on Generate and Edit screens).
 */
export function LiveSummaryCard({
  c,
  form,
}: {
  c: Calc;
  form: QuoteInput;
}) {
  return (
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
      <SummaryRow label="Taxes & Fees (5%)" value={c.taxes} />
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

/**
 * Mobile sticky summary bar with expandable breakdown and action buttons.
 * Used on both Generate and Edit Quote.
 */
export function MobileStickySummary({
  c,
  form,
  saving,
  primaryLabel,
  onPrimary,
  secondaryLabel,
  onSecondary,
}: {
  c: Calc;
  form: QuoteInput;
  saving: boolean;
  primaryLabel: string;
  onPrimary: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rows: { label: string; value: number; negative?: boolean }[] = [
    { label: `Room Charges (${c.nights}N × ${form.rooms})`, value: c.roomTariff },
  ];
  if (c.extraBed > 0) rows.push({ label: `Extra Bed × ${form.extra_bed}`, value: c.extraBed });
  if (c.extraAdults > 0) rows.push({ label: `Extra Adults × ${form.extra_adults}`, value: c.extraAdults });
  if (c.driversCharge > 0) rows.push({ label: `Drivers × ${form.drivers}`, value: c.driversCharge });
  if (c.extraBreakfast > 0) rows.push({ label: `Extra Breakfast × ${form.extra_breakfast_guests}`, value: c.extraBreakfast });
  if (c.pet > 0) rows.push({ label: "Pet Charges", value: c.pet });
  if (c.earlyCheck > 0) rows.push({ label: "Early Check-in", value: c.earlyCheck });
  if (c.lateCheck > 0) rows.push({ label: "Late Check-out", value: c.lateCheck });
  if (form.discount > 0) rows.push({ label: "Discount", value: -form.discount, negative: true });
  rows.push({ label: "Taxes & Fees (5%)", value: c.taxes });

  return (
    <div className="lg:hidden fixed bottom-0 inset-x-0 z-40 border-t border-border bg-background/95 backdrop-blur-lg print:hidden">
      {open && (
        <div className="max-h-[45vh] overflow-y-auto px-4 py-3 border-b border-border/60">
          {rows.map((r) => (
            <div key={r.label} className="flex items-center justify-between py-1 text-xs">
              <span className="text-muted-foreground truncate pr-2">{r.label}</span>
              <span className={cn("tabular-nums shrink-0", r.negative && "text-success")}>
                {r.negative ? "-" : ""}₹{Math.abs(r.value).toLocaleString("en-IN")}
              </span>
            </div>
          ))}
        </div>
      )}
      <div className="px-4 py-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center justify-between w-full mb-2"
        >
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            {open ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
            {c.nights}N · {form.rooms} Room{form.rooms > 1 ? "s" : ""} · {open ? "Hide" : "Show"} breakdown
          </div>
          <div className="font-display text-lg text-gold tabular-nums">
            ₹{c.total.toLocaleString("en-IN")}
          </div>
        </button>
        <div className={cn("grid gap-2", onSecondary ? "grid-cols-2" : "grid-cols-1")}>
          {onSecondary && (
            <button
              onClick={onSecondary}
              disabled={saving}
              className="inline-flex items-center justify-center gap-1.5 rounded-md border border-border bg-card px-3 py-2.5 text-xs font-medium text-foreground disabled:opacity-60"
            >
              <Save className="h-3.5 w-3.5" /> {secondaryLabel ?? "Draft"}
            </button>
          )}
          <button
            onClick={onPrimary}
            disabled={saving}
            className="inline-flex items-center justify-center gap-1.5 rounded-md gold-gradient px-3 py-2.5 text-xs font-medium text-charcoal disabled:opacity-60"
          >
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {primaryLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
