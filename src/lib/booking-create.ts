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
 *   • Activity logging           → handled DB-side by existing triggers on
 *                                  `bookings` / `booking_payments`.
 *
 * Every consumer (current and future Unified Booking Engine) MUST go through
 * this helper rather than re-wiring the steps inline.
 */
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

  return { booking, createdCustomerId };
}
