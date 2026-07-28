/**
 * Shared Checkout Validation Service
 * ----------------------------------
 * Single place where "can this guest check out?" is decided. Every checkout
 * path (booking-level, per-item, future bulk) MUST route through this module
 * so validation rules stay consistent across HEOS.
 *
 * Today it enforces one rule: **outstanding Balance Due blocks Checkout**.
 * Financial ownership stays at the booking level — the same balance check
 * applies whether Reception is checking out a single Booking Item, an entire
 * multi-room booking, or (future) a bulk departure list.
 *
 * The design is intentionally flexible for future expansion:
 *   • Housekeeping-not-complete gate
 *   • Guest-documents-missing gate
 *   • Corporate direct-billing / management override
 *
 * Additional validators plug in as new `Blocker` entries; callers with the
 * appropriate role (admin) can pass `allowOverride: true` to bypass.
 */
import { supabase } from "@/integrations/supabase/client";

export type CheckoutBlocker = {
  code: "balance_due" | "overpayment";
  message: string;
  amount?: number;
};

export type CheckoutValidation = {
  ok: boolean;
  balance: number;
  chargesTotal: number;
  payable: number;
  advance: number;
  blockers: CheckoutBlocker[];
};

/**
 * Load booking financial snapshot needed to evaluate checkout gates.
 * Kept private — callers use `assertCheckoutAllowed` or `validateCheckout`.
 */
async function loadBookingFinancials(bookingId: string): Promise<CheckoutValidation> {
  const { data: booking, error: bErr } = await supabase
    .from("bookings")
    .select("id, amount, advance_paid, status")
    .eq("id", bookingId)
    .maybeSingle();
  if (bErr) throw bErr;
  if (!booking) throw new Error("Booking not found");

  const { data: chargeRows, error: cErr } = await supabase
    .from("booking_charges" as any)
    .select("amount")
    .eq("booking_id", bookingId);
  if (cErr) throw cErr;

  const chargesTotal = (chargeRows ?? []).reduce(
    (s: number, r: any) => s + Number(r.amount || 0),
    0,
  );
  const status = (booking as any).status as string;
  const payable = Number((booking as any).amount || 0) + chargesTotal;
  const advance = Number((booking as any).advance_paid || 0);
  const balance =
    status === "Cancelled" || status === "No-Show" ? 0 : payable - advance;

  const blockers: CheckoutBlocker[] = [];
  if (balance > 0) {
    blockers.push({
      code: "balance_due",
      message: `Balance due ₹${balance.toLocaleString("en-IN")} — collect payment before check-out.`,
      amount: balance,
    });
  }
  if (balance < 0) {
    blockers.push({
      code: "overpayment",
      message: `Overpayment ₹${Math.abs(balance).toLocaleString("en-IN")} — refund the excess before check-out.`,
      amount: Math.abs(balance),
    });
  }

  return {
    ok: blockers.length === 0,
    balance,
    chargesTotal,
    payable,
    advance,
    blockers,
  };
}

export async function validateCheckout(bookingId: string): Promise<CheckoutValidation> {
  return loadBookingFinancials(bookingId);
}

/**
 * Throws a user-facing error when checkout must be blocked.
 *   • `allowOverride: true` bypasses only the `balance_due` blocker (admin path).
 *   • Overpayment always blocks — refund must be issued first.
 */
export async function assertCheckoutAllowed(
  bookingId: string,
  opts: { allowOverride?: boolean } = {},
): Promise<CheckoutValidation> {
  const v = await validateCheckout(bookingId);
  if (v.ok) return v;
  const filtered = opts.allowOverride
    ? v.blockers.filter((b) => b.code !== "balance_due")
    : v.blockers;
  if (filtered.length > 0) {
    // First blocker becomes the surfaced error message.
    const err: any = new Error(filtered[0].message);
    err.blockers = filtered;
    err.balance = v.balance;
    throw err;
  }
  return v;
}
