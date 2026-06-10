/**
 * Guest Portal — Payment Options card (scaffolding for next sprint).
 *
 * Renders the three payment paths a guest can choose on a public booking link:
 *   - Full Payment   → Razorpay (balance_due)
 *   - Part Payment   → Razorpay (custom amount, min = part_payment_value, max = balance_due)
 *   - Pay At Hotel   → no online txn; just acknowledge intent
 *
 * Wiring to Razorpay + booking_payments creation happens in the dedicated
 * Guest Portal + Razorpay sprint. This component is intentionally headless of
 * any payment SDK so it can be reused once credentials are wired.
 */
import { useState } from "react";
import { CreditCard, IndianRupee, Hotel, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type PortalPaymentChoice =
  | { kind: "full" }
  | { kind: "part"; amount: number }
  | { kind: "pay_at_hotel" };

export interface PaymentOptionsProps {
  totalAmount: number;
  advancePaid: number;
  /** Minimum part-payment amount (from booking.part_payment_value when type === 'fixed', else 0). */
  minPartPayment?: number;
  allowFull?: boolean;
  allowPart?: boolean;
  allowPayAtHotel?: boolean;
  /** Default part payment percent (e.g. 25 → prefill 25% of balance). */
  defaultPartPercent?: number;
  /** Disable while parent is initiating a Razorpay order. */
  busy?: boolean;
  onChoose: (choice: PortalPaymentChoice) => void | Promise<void>;
}

const inr = (n: number) => `₹${Math.round(Number(n) || 0).toLocaleString("en-IN")}`;

export function PortalPaymentOptions({
  totalAmount, advancePaid, minPartPayment = 0,
  allowFull = true, allowPart = true, allowPayAtHotel = true, defaultPartPercent = 0,
  busy, onChoose,
}: PaymentOptionsProps) {
  const balance = Math.max(0, totalAmount - advancePaid);
  const initialMode: "full" | "part" | "pay_at_hotel" =
    allowFull ? "full" : allowPart ? "part" : "pay_at_hotel";
  const [mode, setMode] = useState<"full" | "part" | "pay_at_hotel">(initialMode);
  const prefillPart = defaultPartPercent > 0 ? Math.round((balance * defaultPartPercent) / 100) : Math.round(balance / 2);
  const [partAmt, setPartAmt] = useState<number>(Math.max(minPartPayment, prefillPart));

  const submit = () => {
    if (mode === "full") onChoose({ kind: "full" });
    else if (mode === "pay_at_hotel") onChoose({ kind: "pay_at_hotel" });
    else onChoose({ kind: "part", amount: Math.max(minPartPayment, Math.min(balance, Math.round(partAmt) || 0)) });
  };

  return (
    <div className="luxe-card rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-lg">Complete Your Booking</h3>
        <div className="text-xs text-muted-foreground">Balance: <span className="text-foreground font-medium">{inr(balance)}</span></div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {allowFull && <OptionTile active={mode === "full"} onClick={() => setMode("full")} icon={CreditCard} label="Pay Full" sub={inr(balance)} />}
        {allowPart && <OptionTile active={mode === "part"} onClick={() => setMode("part")} icon={IndianRupee} label="Part Payment" sub={defaultPartPercent > 0 ? `${defaultPartPercent}% Advance` : "Pay Advance"} />}
        {allowPayAtHotel && <OptionTile active={mode === "pay_at_hotel"} onClick={() => setMode("pay_at_hotel")} icon={Hotel} label="Pay at Hotel" sub="On Check-In" />}
      </div>

      {mode === "part" && (
        <label className="block">
          <span className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Amount (₹)</span>
          <input
            type="number" inputMode="numeric"
            min={minPartPayment || 0} max={balance}
            value={partAmt}
            onChange={(e) => setPartAmt(Number(e.target.value) || 0)}
            className="w-full bg-input/60 border border-border rounded-md px-3 py-2 text-sm"
          />
          {minPartPayment > 0 && (
            <p className="text-[10px] text-muted-foreground mt-1">Minimum advance: {inr(minPartPayment)}</p>
          )}
        </label>
      )}

      <button
        onClick={submit}
        disabled={busy || balance <= 0 && mode !== "pay_at_hotel"}
        className="w-full inline-flex items-center justify-center gap-2 rounded-md gold-gradient px-4 py-3 text-sm font-medium text-charcoal disabled:opacity-60"
      >
        {busy && <Loader2 className="h-4 w-4 animate-spin" />}
        {mode === "pay_at_hotel" ? "Confirm — Pay at Hotel" : "Proceed to Pay"}
      </button>

      <p className="text-[10px] text-muted-foreground text-center">
        Online payments are processed via Razorpay. Pay-at-Hotel reserves your room — full amount due at check-in.
      </p>
    </div>
  );
}

function OptionTile({ active, onClick, icon: Icon, label, sub }: any) {
  return (
    <button onClick={onClick}
      className={cn("rounded-lg border p-3 text-left transition", active ? "border-gold/60 bg-gold-soft" : "border-border bg-card hover:border-gold/30")}>
      <Icon className={cn("h-4 w-4 mb-2", active ? "text-gold" : "text-muted-foreground")} />
      <div className="text-sm font-medium">{label}</div>
      <div className="text-[10px] text-muted-foreground">{sub}</div>
    </button>
  );
}
