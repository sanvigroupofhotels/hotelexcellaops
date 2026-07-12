/**
 * Single source of truth for "create a new booking" — the exact pipeline that
 * the Detailed Booking Form (`bookings_.new.tsx`) and the Quick Booking Form
 * (`bookings_.quick.tsx`) both call. Wraps existing shared services so neither
 * UI re-implements business logic:
 *
 *   • Customer Lookup / Create   → `customers-api`
 *   • Booking Creation           → `bookings-api.createBooking`
 *                                  (which emits notifications via
 *                                   `notification-engine.emitBookingCreated`)
 *   • Booking Items              → `booking-items-api.addBookingItems`
 *   • Initial Advance Payment    → `booking-payments-api.createBookingPayment`
 *                                  (DB trigger recomputes advance_paid and
 *                                   auto-creates a Cash Book entry on Cash)
 *   • Source Quote close-out     → `quotes-api.setStatus("Confirmed")`
 *   • Past-Due Carry Forward     → v1.1 UAT-024: if the customer has a prior
 *                                  Checked-Out booking with an outstanding
 *                                  balance, auto-attach a "Past Due" charge
 *                                  to the new booking. This turns the
 *                                  customer's ledger into a running tab
 *                                  across stays.
 *   • Housekeeping check-in hook  → v1.1 UAT-007: if the new booking is
 *                                  created directly as Checked-In (walk-in
 *                                  with same-day check-in after another guest
 *                                  already vacated), fire the check-in hook
 *                                  so the operational workflow transitions
 *                                  from Checkout back to Service correctly.
 *   • Activity logging           → handled DB-side by existing triggers on
 *                                  `bookings` / `booking_payments`.
 *
 * Every consumer (current and future Unified Booking Engine) MUST go through
 * this helper rather than re-wiring the steps inline.
 */
import { supabase } from "@/integrations/supabase/client";
import { createCustomer } from "@/lib/customers-api";
import { createBooking, type BookingInput, type BookingRow } from "@/lib/bookings-api";
import { addBookingItems, type BookingItemInput } from "@/lib/booking-items-api";

export interface SubmitNewBookingInput {
  /** Already-linked customer (existing record). */
  linkedCustomerId?: string | null;
  /** Pre-create a brand new customer record before booking (Force-New flow). */
  forceNew?: boolean;
  /** Optional source quote — if provided, status is flipped to Confirmed on success. */
  fromQuoteId?: string | null;
  /** Booking row payload — `customer_id` is overwritten by the resolved customer. */
  booking: Omit<BookingInput, "customer_id">;
  /** Items to attach (primary + extras / additional rooms). */
  items: BookingItemInput[];
  /** Optional initial advance — written via the proper booking_payments path. */
  advance?: {
    amount: number;
    payment_mode: string;
  };
}

export interface SubmitNewBookingResult {
  booking: BookingRow;
  createdCustomerId: string | null;
  /** UAT-024: amount carried forward from a prior unpaid stay (0 if none). */
  carriedForward?: number;
}

export async function submitNewBooking(input: SubmitNewBookingInput): Promise<SubmitNewBookingResult> {
  let effectiveCustomerId: string | null = input.linkedCustomerId ?? null;
  let createdCustomerId: string | null = null;

  if (!effectiveCustomerId && input.forceNew) {
    const created = await createCustomer({
      guest_name: input.booking.guest_name,
      phone: input.booking.phone ?? null,
      email: input.booking.email ?? null,
      lead_source: input.booking.lead_source ?? "Direct",
    });
    effectiveCustomerId = created.id;
    createdCustomerId = created.id;
  }

  const payload: BookingInput = {
    ...input.booking,
    customer_id: effectiveCustomerId,
    source_quote_id: input.fromQuoteId ?? null,
    // booking_payments trigger owns advance_paid — never write it directly here.
    advance_paid: 0,
  };

  const booking = await createBooking(payload);

  // v1.1 UAT-029 — Booking Creation audit trail. Emit BEFORE items /
  // advance / carry-forward / HK hooks so this is always the first entry
  // in the booking's Activity History. Append-only ⇒ non-editable.
  try {
    const { logBookingActivity } = await import("@/lib/booking-activities-api");
    let roomLabels: string[] = [];
    try {
      const { data: asgn } = await supabase
        .from("booking_room_assignments" as any)
        .select("rooms ( room_number )")
        .eq("booking_id", booking.id);
      roomLabels = ((asgn ?? []) as any[])
        .map((r) => r?.rooms?.room_number)
        .filter(Boolean);
    } catch { /* non-fatal */ }
    await logBookingActivity({
      booking_id: booking.id,
      action: "booking_created" as any,
      from_status: null,
      to_status: booking.status ?? "Pending",
      notes: `Booking Created · ${booking.booking_reference}`,
      metadata: {
        source: (booking as any).source ?? null,
        initial_status: booking.status ?? "Pending",
        rooms: roomLabels,
        check_in: (booking as any).check_in ?? null,
        check_out: (booking as any).check_out ?? null,
        guest_name: (booking as any).guest_name ?? null,
        booking_reference: booking.booking_reference,
      },
    });
  } catch (e) {
    console.warn("booking_created activity log failed", e);
  }

  if (input.items.length > 0) {
    await addBookingItems(booking.id, input.items);
  }

  if (input.advance && input.advance.amount > 0) {
    const { createBookingPayment } = await import("@/lib/booking-payments-api");
    const { listStaff } = await import("@/lib/cash-api");
    const staff = await listStaff(true);
    const collectedBy = staff[0]?.name ?? "Front Desk";
    await createBookingPayment({
      booking_id: booking.id,
      customer_id: booking.customer_id,
      amount: input.advance.amount,
      payment_mode: input.advance.payment_mode,
      collected_by: collectedBy,
      notes: `Initial advance · ${booking.booking_reference}`,
    });
  }

  if (input.fromQuoteId) {
    try {
      const { setStatus: setQuoteStatus } = await import("@/lib/quotes-api");
      await setQuoteStatus(input.fromQuoteId, "Confirmed");
    } catch {
      // non-fatal — quote close-out is best-effort.
    }
  }

  // v1.1 UAT-024 — Past-Due Carry Forward.
  // Runs after items are attached (so charges show alongside the new stay's
  // totals) but before we return, so the caller sees the definitive booking.
  let carriedForward = 0;
  if (booking.customer_id) {
    try {
      carriedForward = await carryForwardPastDue(booking);
    } catch (e) {
      // Non-blocking — carry-forward is a convenience, not a gate on booking creation.
      console.warn("carryForwardPastDue failed", e);
    }
  }

  // v1.1 UAT-007 — HK check-in hook for direct walk-ins. Rare path: a
  // reception user creates a booking already flagged Checked-In (walk-in).
  // `setBookingStatus` wouldn't have fired because we skipped it; call the
  // hook here so a room previously in Checkout workflow transitions to
  // Service for the new guest.
  if (booking.status === "Checked-In") {
    try {
      const { onBookingCheckedIn } = await import("@/lib/hk-checkout-hook");
      await onBookingCheckedIn(booking.id);
    } catch {
      /* non-blocking — hook logs its own failures */
    }
  }

  return { booking, createdCustomerId, carriedForward };
}

/**
 * UAT-024 — carry the customer's unsettled balance from their most recent
 * Checked-Out booking onto this new booking as a "Past Due" charge.
 *
 * Rules:
 *   • Look at the same customer's most recent booking with status =
 *     Checked-Out or Stay Completed (any force-checkout variant lands here).
 *   • Compute outstanding = (booking.amount + booking_charges - advance_paid).
 *   • If outstanding > 0 AND the new booking does not already have a Past Due
 *     charge, create one on the new booking referencing the prior stay.
 *   • Idempotent: safe to re-run — an existing Past Due row referencing the
 *     same prior booking short-circuits.
 *   • Activity log entries land on both bookings.
 */
async function carryForwardPastDue(newBooking: BookingRow): Promise<number> {
  if (!newBooking.customer_id) return 0;

  // Find the most recent prior booking for this customer that has closed out.
  const { data: priors } = await supabase
    .from("bookings" as any)
    .select("id, booking_reference, amount, advance_paid, check_out, status")
    .eq("customer_id", newBooking.customer_id)
    .neq("id", newBooking.id)
    .in("status", ["Checked-Out", "Stay Completed"])
    .order("check_out", { ascending: false })
    .limit(1);
  const prior = (priors ?? [])[0] as any;
  if (!prior) return 0;

  // Sum any booking_charges on the prior stay so the carry-forward reflects
  // the full folio total (room + F&B + laundry + past-due itself), not just
  // the base amount.
  const { data: chargeRows } = await supabase
    .from("booking_charges" as any)
    .select("amount")
    .eq("booking_id", prior.id);
  const priorCharges = ((chargeRows ?? []) as any[]).reduce(
    (s, r) => s + Number(r.amount || 0), 0,
  );
  const outstanding = Number(prior.amount ?? 0) + priorCharges - Number(prior.advance_paid ?? 0);
  if (outstanding <= 0.5) return 0; // Sub-rupee dust — treat as settled.

  // Idempotency guard — never stack two Past Due charges for the same prior
  // booking on the same new booking.
  const { data: existing } = await supabase
    .from("booking_charges" as any)
    .select("id")
    .eq("booking_id", newBooking.id)
    .eq("category", "Past Due")
    .ilike("notes", `%${prior.booking_reference}%`)
    .limit(1);
  if ((existing ?? []).length > 0) return 0;

  const { createBookingCharge } = await import("@/lib/booking-charges-api");
  await createBookingCharge({
    booking_id: newBooking.id,
    category: "Past Due",
    quantity: 1,
    unit_price: Math.round(outstanding * 100) / 100,
    notes: `Carried forward from ${prior.booking_reference}`,
    added_by: "System",
  });

  // Cross-link activity on both bookings so future audits can trace the ledger.
  try {
    const { logBookingActivity } = await import("@/lib/booking-activities-api");
    await Promise.all([
      logBookingActivity({
        booking_id: newBooking.id,
        action: "past_due_carried_in" as any,
        from_status: null, to_status: null,
        notes: `Past Due ₹${Math.round(outstanding)} carried forward from ${prior.booking_reference}`,
      }),
      logBookingActivity({
        booking_id: prior.id,
        action: "past_due_carried_out" as any,
        from_status: null, to_status: null,
        notes: `Balance ₹${Math.round(outstanding)} carried forward to ${newBooking.booking_reference}`,
      }),
    ]);
  } catch {
    /* activity log is best-effort */
  }

  return Math.round(outstanding * 100) / 100;
}
