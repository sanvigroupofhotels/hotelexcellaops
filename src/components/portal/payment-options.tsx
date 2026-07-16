/**
 * Guest Portal — Payment Options card.
 *
 * Three intents:
 *   - full          → Razorpay for balance_due
 *   - part          → Razorpay for auto-computed advance (defaultPartPercent of balance).
 *                     Guest never enters the amount for this intent — UAT-025.
 *   - pay_at_hotel  → no online txn; guest acknowledges intent
 *
 * Future extension: a distinct "custom" intent will surface an amount input.
 * We intentionally do NOT combine "part" with manual amount entry so the
 * 25% Advance flow stays one-tap.
 */
import { useMemo, useState } from "react";
import { CreditCard, IndianRupee, Hotel, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type PortalPaymentChoice =
  | { kind: "full" }
  | { kind: "part"; amount: number }
  | { kind: "pay_at_hotel" };

export interface PaymentOptionsProps {
  totalAmount: number;
  advancePaid: number;
  /** Reserved for a future fixed-minimum flow; unused in the auto part path. */
  minPartPayment?: number;
  allowFull?: boolean;
  allowPart?: boolean;
  allowPayAtHotel?: boolean;
  /** Advance percent when Part Payment is selected (e.g. 25). */
  defaultPartPercent?: number;
  busy?: boolean;
  onChoose: (choice: PortalPaymentChoice) => void | Promise<void>;
}

const inr = (n: number) =>
  `₹${(Math.round(Number(n || 0) * 100) / 100).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

export function PortalPaymentOptions({
  totalAmount, advancePaid,
  allowFull = true, allowPart = true, allowPayAtHotel = true, defaultPartPercent = 0,
  busy, onChoose,
}: PaymentOptionsProps) {
  // Paise-safe balance to avoid float drift on tiny amounts.
  const balancePaise = Math.max(0, Math.round(totalAmount * 100) - Math.round(advancePaid * 100));
  const balance = balancePaise / 100;

  // Auto-computed advance for the "part" intent. Rounded UP to the nearest
  // paise so ₹1 * 25% never becomes ₹0 and the total ever-collected never
  // falls short of the configured percent.
  const partPercent = defaultPartPercent > 0 ? defaultPartPercent : 25;
  const partAmount = useMemo(() => {
    const paise = Math.ceil((balancePaise * partPercent) / 100);
    return Math.min(balancePaise, paise) / 100;
  }, [balancePaise, partPercent]);

  const initialMode: "full" | "part" | "pay_at_hotel" =
    allowFull ? "full" : allowPart ? "part" : "pay_at_hotel";
  const [mode, setMode] = useState<"full" | "part" | "pay_at_hotel">(initialMode);

  const submit = () => {
    if (mode === "full") onChoose({ kind: "full" });
    else if (mode === "pay_at_hotel") onChoose({ kind: "pay_at_hotel" });
    else onChoose({ kind: "part", amount: partAmount });
  };

  return (
    <div className="luxe-card rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-lg">Complete Your Booking</h3>
        <div className="text-xs text-muted-foreground">Balance: <span className="text-foreground font-medium">{inr(balance)}</span></div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {allowFull && <OptionTile active={mode === "full"} onClick={() => setMode("full")} icon={CreditCard} label="Pay Full" sub={inr(balance)} />}
        {allowPart && <OptionTile active={mode === "part"} onClick={() => setMode("part")} icon={IndianRupee} label={`Pay ${partPercent}% Advance`} sub={inr(partAmount)} />}
        {allowPayAtHotel && <OptionTile active={mode === "pay_at_hotel"} onClick={() => setMode("pay_at_hotel")} icon={Hotel} label="Pay at Hotel" sub="On Check-In" />}
      </div>

      {mode === "part" && (
        <div className="text-[11px] text-muted-foreground rounded-md border border-border/60 bg-muted/10 px-3 py-2">
          You will pay <span className="text-foreground font-medium">{inr(partAmount)}</span> now
          ({partPercent}% of the outstanding balance). The remaining {inr(balance - partAmount)} is
          due at the hotel.
        </div>
      )}

      <button
        onClick={submit}
        disabled={busy || (balance <= 0 && mode !== "pay_at_hotel")}
        className="w-full inline-flex items-center justify-center gap-2 rounded-md gold-gradient px-4 py-3 text-sm font-medium text-charcoal disabled:opacity-60"
      >
        {busy && <Loader2 className="h-4 w-4 animate-spin" />}
        {mode === "pay_at_hotel" ? "Confirm — Pay at Hotel" : "Proceed to Pay"}
      </button>

      <p className="text-[10px] text-muted-foreground text-center">
        {allowPayAtHotel
          ? "Online payments are processed via Razorpay. Pay-at-Hotel reserves your room — full amount due at check-in."
          : "Online payments are processed securely via Razorpay."}
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
