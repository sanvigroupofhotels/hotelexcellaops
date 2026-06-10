/**
 * Public Guest Portal — view booking + pay via Razorpay.
 *
 * URL: /portal/$token
 *
 * Flow:
 *   1. Loads booking summary via `getPortalBooking` (public server fn, admin-scoped read).
 *   2. Guest picks Full / Part / Pay-at-Hotel via PortalPaymentOptions.
 *   3. For Razorpay options we call `createRazorpayOrder`, then open Razorpay Checkout.
 *   4. On success, Razorpay fires `payment.captured` webhook → server inserts a
 *      booking_payments row → existing DB triggers recompute advance_paid /
 *      balance_due / cashbook / payment audit / booking status.
 *
 * Notes:
 *   - This route is public (no auth gate) and SSR-safe; Razorpay Checkout is
 *     only loaded after the user clicks Pay.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import {
  getPortalBooking,
  createRazorpayOrder,
  recordPayAtHotelIntent,
} from "@/lib/portal.functions";
import { PortalPaymentOptions, type PortalPaymentChoice } from "@/components/portal/payment-options";

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
});

const inr = (n: number) => `₹${Math.round(Number(n) || 0).toLocaleString("en-IN")}`;

/** Extract a readable message from any thrown value (Error, serverFn envelope, plain object). */
function errMsg(e: any, fallback = "Something went wrong"): string {
  if (!e) return fallback;
  if (typeof e === "string") return e;
  if (e instanceof Error && e.message) return e.message;
  const m = e?.message ?? e?.error?.message ?? e?.body?.message ?? e?.data?.message ?? e?.json?.message;
  if (typeof m === "string" && m) return m;
  try { const s = JSON.stringify(e); if (s && s !== "{}") return s; } catch {}
  return fallback;
}

declare global {
  interface Window {
    Razorpay?: any;
  }
}

function loadRazorpayCheckout(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined") return reject(new Error("Not in browser"));
    if (window.Razorpay) return resolve();
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Failed to load Razorpay"));
    document.body.appendChild(s);
  });
}

function GuestPortal() {
  const { token } = Route.useParams();
  const fetchBooking = useServerFn(getPortalBooking);
  const createOrder = useServerFn(createRazorpayOrder);
  const recordIntent = useServerFn(recordPayAtHotelIntent);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<null | "paid" | "pay_at_hotel">(null);

  const q = useQuery({
    queryKey: ["portal-booking", token],
    queryFn: () => fetchBooking({ data: { token } }),
    retry: false,
  });

  if (q.isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-gold" />
      </div>
    );
  }
  if (q.error) throw q.error instanceof Error ? q.error : new Error(errMsg(q.error, "Booking link not found"));
  if (!q.data) throw new Error("Booking link not found");
  const b = q.data;

  const onChoose = async (choice: PortalPaymentChoice) => {
    setBusy(true);
    try {
      if (choice.kind === "pay_at_hotel") {
        await recordIntent({ data: { token } });
        setDone("pay_at_hotel");
        toast.success("Noted — you can pay at the hotel on check-in.");
        return;
      }
      const amount = choice.kind === "full" ? b.balanceDue : choice.amount;
      const order = await createOrder({ data: { token, amount, intent: choice.kind } });
      await loadRazorpayCheckout();
      const rzp = new window.Razorpay({
        key: order.keyId,
        order_id: order.orderId,
        amount: order.amount,
        currency: order.currency,
        name: "Hotel Excella",
        description: `Booking ${order.bookingReference}`,
        prefill: { name: order.guestName, contact: order.phone || "" },
        theme: { color: "#D4AF37" },
        handler: () => {
          // Webhook will record the payment authoritatively; this just gives instant UX feedback.
          setDone("paid");
          toast.success("Payment received. We're confirming with the bank.");
          q.refetch();
        },
        modal: {
          ondismiss: () => setBusy(false),
        },
      });
      rzp.on("payment.failed", (resp: any) => {
        toast.error(resp?.error?.description || "Payment failed");
        setBusy(false);
      });
      rzp.open();
    } catch (e: any) {
      toast.error(e?.message || "Could not start payment");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-background py-8 px-4">
      <div className="max-w-xl mx-auto space-y-4">
        <div className="luxe-card rounded-xl p-5">
          <div className="text-xs uppercase tracking-wider text-gold mb-1">Booking · {b.reference}</div>
          <h1 className="font-display text-2xl mb-3">Welcome, {b.guestName}</h1>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <Field label="Check-In" value={b.checkIn} />
            <Field label="Check-Out" value={b.checkOut} />
            <Field label="Room" value={b.roomType} />
            <Field label="Guests" value={String(b.guests)} />
            <Field label="Total" value={inr(b.totalAmount)} />
            <Field label="Paid" value={inr(b.advancePaid)} />
          </div>
        </div>

        {done ? (
          <div className="luxe-card rounded-xl p-6 text-center space-y-2">
            <CheckCircle2 className="h-10 w-10 text-emerald-500 mx-auto" />
            <h3 className="font-display text-lg">
              {done === "paid" ? "Thank you — payment received" : "We'll see you at check-in"}
            </h3>
            <p className="text-sm text-muted-foreground">
              {done === "paid"
                ? "Your booking will reflect the updated balance shortly."
                : "Please complete your remaining payment when you arrive."}
            </p>
          </div>
        ) : (
          <PortalPaymentOptions
            totalAmount={b.totalAmount}
            advancePaid={b.advancePaid}
            minPartPayment={b.minPartPayment}
            busy={busy}
            onChoose={onChoose}
          />
        )}

        <p className="text-[10px] text-center text-muted-foreground pt-4">
          Secured by Razorpay · Your payment details never touch our servers.
        </p>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-foreground">{value || "—"}</div>
    </div>
  );
}
