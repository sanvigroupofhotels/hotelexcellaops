/**
 * Public Guest Portal (scaffolding for the dedicated Razorpay sprint).
 *
 * URL: /portal/$token  (public — anyone with the link can view)
 *
 * Sprint-N scope (this pass):
 *   - Public route registered & SSR-safe
 *   - Renders a stub booking summary + payment-options card
 *
 * Sprint-N+1 scope (next pass — Razorpay):
 *   - Load booking via createServerFn using supabaseAdmin + booking_tokens
 *   - Razorpay order creation + verify webhook
 *   - On successful charge: create booking_payments row → triggers
 *     auto-recompute of advance_paid, balance_due, cashbook, payment audit
 *
 * NOTE: This page intentionally does not query Supabase yet to avoid wiring
 * an unverified public read path before the dedicated sprint.
 */
import { createFileRoute } from "@tanstack/react-router";
import { PortalPaymentOptions } from "@/components/portal/payment-options";
import { toast } from "sonner";

export const Route = createFileRoute("/portal/$token")({
  component: GuestPortal,
  head: () => ({
    meta: [
      { title: "Complete Your Booking" },
      { name: "description", content: "Review your booking and complete your payment securely." },
    ],
  }),
  errorComponent: ({ error }) => (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="luxe-card rounded-xl p-6 max-w-md text-center space-y-2">
        <h1 className="font-display text-xl">Link unavailable</h1>
        <p className="text-sm text-muted-foreground">{error?.message ?? "This booking link could not be loaded."}</p>
      </div>
    </div>
  ),
  notFoundComponent: () => (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="luxe-card rounded-xl p-6 max-w-md text-center">
        <h1 className="font-display text-xl mb-2">Link expired</h1>
        <p className="text-sm text-muted-foreground">This booking link has expired or is invalid.</p>
      </div>
    </div>
  ),
});

function GuestPortal() {
  const { token } = Route.useParams();

  // Placeholder data — Sprint N+1 replaces this with a server fn lookup.
  const stub = {
    reference: "—",
    guestName: "Guest",
    checkIn: "",
    checkOut: "",
    totalAmount: 0,
    advancePaid: 0,
    minPartPayment: 0,
  };

  return (
    <div className="min-h-screen bg-background py-8 px-4">
      <div className="max-w-xl mx-auto space-y-4">
        <div className="luxe-card rounded-xl p-5">
          <div className="text-xs uppercase tracking-wider text-gold mb-1">Booking · {stub.reference}</div>
          <h1 className="font-display text-2xl mb-1">Welcome, {stub.guestName}</h1>
          <p className="text-sm text-muted-foreground">
            Guest Portal is being prepared. Your secure payment link <code className="text-[11px]">{token}</code> will activate
            once the Razorpay integration is enabled.
          </p>
        </div>

        <PortalPaymentOptions
          totalAmount={stub.totalAmount}
          advancePaid={stub.advancePaid}
          minPartPayment={stub.minPartPayment}
          onChoose={(choice) => {
            // Sprint N+1: kick off Razorpay order or record Pay-At-Hotel intent.
            toast.info(`Selected: ${choice.kind} — wired in the next sprint`);
          }}
        />
      </div>
    </div>
  );
}
