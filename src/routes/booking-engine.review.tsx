/**
 * Booking Engine — Step 4 (Review your price).
 * Two-column comparison: Pay Now (inventory price) vs Pay Later (inventory + 5%).
 * Action button lives INSIDE each column.
 */
import { createFileRoute, useNavigate, useSearch, Link } from "@tanstack/react-router";
import { z } from "zod";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  getConfirmation,
  createBookingEngineOrder,
  confirmBookingEnginePayment,
  confirmPayAtHotel,
} from "@/lib/booking-engine.functions";
import { getRoomMeta } from "@/lib/booking-engine-rooms";
import { useEngineConfig } from "./booking-engine";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  ArrowLeft, BedDouble, CalendarDays, Users, Check, Loader2, Shield,
} from "lucide-react";

const Schema = z.object({
  booking_id: z.string().uuid(),
  room_type: z.string(),
  check_in: z.string(),
  check_out: z.string(),
  guests: z.coerce.number().int().min(1).max(10),
});

export const Route = createFileRoute("/booking-engine/review")({
  component: ReviewPage,
  validateSearch: (raw) => Schema.parse(raw),
});

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const dateLabel = (iso: string) =>
  new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short", year: "numeric" });

declare global {
  interface Window {
    Razorpay?: any;
  }
}

function nightsBetween(a: string, b: string): number {
  const t1 = new Date(a + "T00:00:00").getTime();
  const t2 = new Date(b + "T00:00:00").getTime();
  return Math.max(1, Math.round((t2 - t1) / 86_400_000));
}

function ReviewPage() {
  const search = useSearch({ from: "/booking-engine/review" });
  const navigate = useNavigate();
  const { data: cfg } = useEngineConfig();
  const [busy, setBusy] = useState<"now" | "later" | null>(null);

  const getInfo = useServerFn(getConfirmation);
  const createOrder = useServerFn(createBookingEngineOrder);
  const confirmPay = useServerFn(confirmBookingEnginePayment);
  const confirmPah = useServerFn(confirmPayAtHotel);

  // Load draft pricing via getConfirmation (works for Draft too — it just
  // selects by reference + source). We need the inventory amount.
  // The reference is unknown here; instead read the booking by id via a thin
  // helper: we already have createOrder which fetches by id internally for
  // pricing, but cleaner — derive total from a small query keyed on booking_id.
  // For now, use the per-night display the user already saw: fetch via
  // a lightweight read. We re-use getConfirmation by reference once we have it;
  // simpler path: get the order pre-create with intent=full to learn amount.
  // To avoid an extra round-trip, we just query an `amount` snapshot via
  // getConfirmation-equivalent: load by ID through createOrder is destructive.
  // Cleanest: a tiny new server fn would be ideal, but we can reuse
  // createBookingEngineOrder safely — it does NOT mutate booking pricing.

  // Use a dedicated lightweight query: we issue a "preview" by fetching
  // confirmation data by ID through a small inline read.
  const q = useQuery({
    queryKey: ["be", "review", search.booking_id],
    queryFn: async () => {
      // Reuse getConfirmation by reference would require the reference; instead
      // we use createBookingEngineOrder side-effect-free preview. But that
      // creates a Razorpay order — undesirable for a preview. So we read via
      // a public client query instead.
      const { supabase } = await import("@/integrations/supabase/client");
      const { data, error } = await supabase
        .from("bookings")
        .select("amount,subtotal,taxes,booking_reference,status,draft_expires_at")
        .eq("id", search.booking_id)
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("Booking not found");
      return data as any;
    },
    staleTime: 30_000,
  });

  // Load Razorpay script
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.Razorpay) return;
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.async = true;
    document.body.appendChild(s);
  }, []);

  const nights = nightsBetween(search.check_in, search.check_out);
  const meta = getRoomMeta(search.room_type);
  const payNowTotal = Math.round(Number(q.data?.amount ?? 0));
  const payLaterTotal = Math.round(payNowTotal * 1.05);
  const payNowPerNight = Math.round(payNowTotal / Math.max(1, nights));
  const payLaterPerNight = Math.round(payLaterTotal / Math.max(1, nights));

  async function payNow() {
    if (!payNowTotal) return;
    setBusy("now");
    try {
      const order = await createOrder({
        data: { booking_id: search.booking_id, intent: "full", amount: payNowTotal },
      });
      await new Promise<void>((resolve) => {
        let tries = 0;
        const wait = () => {
          if (window.Razorpay) return resolve();
          if (++tries > 40) return resolve();
          setTimeout(wait, 50);
        };
        wait();
      });
      if (!window.Razorpay) {
        toast.error("Payment SDK could not load. Please try again or choose Pay Later.");
        setBusy(null);
        return;
      }
      const rz = new window.Razorpay({
        key: order.keyId,
        order_id: order.orderId,
        amount: order.amount,
        currency: order.currency,
        name: cfg?.hotel.name || "Hotel Excella",
        description: `Booking ${order.bookingReference}`,
        prefill: { name: order.guestName, contact: order.phone },
        theme: { color: "#caa264" },
        handler: async (resp: any) => {
          try {
            const r = await confirmPay({
              data: {
                booking_id: search.booking_id,
                razorpay_order_id: resp.razorpay_order_id,
                razorpay_payment_id: resp.razorpay_payment_id,
                razorpay_signature: resp.razorpay_signature,
              },
            });
            navigate({ to: "/booking-engine/confirmation/$ref", params: { ref: r.reference } });
          } catch (e: any) {
            toast.error(e?.message ?? "Payment verification failed");
          }
        },
        modal: { ondismiss: () => setBusy(null) },
      });
      rz.open();
    } catch (e: any) {
      toast.error(e?.message ?? "Could not initiate payment");
      setBusy(null);
    }
  }

  async function payLater() {
    setBusy("later");
    try {
      const r = await confirmPah({ data: { booking_id: search.booking_id, pay_later: true } });
      navigate({ to: "/booking-engine/confirmation/$ref", params: { ref: r.reference } });
    } catch (e: any) {
      toast.error(e?.message ?? "Could not confirm. Please try again.");
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 pb-12">
      <Link
        to="/booking-engine/checkout"
        search={{
          check_in: search.check_in,
          check_out: search.check_out,
          guests: search.guests,
          room_type: search.room_type,
        } as any}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back to guest details
      </Link>

      <h1 className="mt-3 font-display text-2xl">Review your price</h1>
      <p className="text-sm text-muted-foreground">Choose how you would like to pay.</p>

      {/* Stay summary */}
      <Card className="mt-4 p-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <span className="inline-flex items-center gap-1.5"><BedDouble className="h-4 w-4 text-gold" /> {search.room_type}</span>
          <span className="inline-flex items-center gap-1.5"><CalendarDays className="h-4 w-4 text-gold" /> {dateLabel(search.check_in)} → {dateLabel(search.check_out)}</span>
          <span className="inline-flex items-center gap-1.5"><Users className="h-4 w-4 text-gold" /> {search.guests} guest{search.guests > 1 ? "s" : ""}</span>
        </div>
        <div className="mt-3 text-xs text-muted-foreground">
          Check-in from {cfg?.ops.check_in_time ?? "13:00"} · Check-out by {cfg?.ops.check_out_time ?? "11:00"}
        </div>
      </Card>

      {/* Pay Now / Pay Later */}
      <Card className="mt-4 p-0 overflow-hidden">
        {q.isLoading ? (
          <div className="p-8 flex items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : q.isError ? (
          <div className="p-6 text-sm text-destructive">
            {(q.error as Error)?.message || "Could not load pricing."}
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-border">
            {/* Pay Now */}
            <div className="p-5 flex flex-col">
              <p className="text-xs uppercase tracking-wider text-gold font-medium">Pay Now</p>
              <p className="text-sm text-muted-foreground mt-0.5">Pay Online & Save</p>

              <div className="mt-4">
                {meta.mrp > 0 && (
                  <p className="text-sm text-muted-foreground line-through">{inr(meta.mrp)}</p>
                )}
                <p className="font-display text-3xl text-foreground leading-tight">{inr(payNowPerNight)}</p>
                <p className="text-[11px] text-muted-foreground">Per night</p>
                <p className="text-[11px] text-muted-foreground">(Inclusive of all taxes)</p>
              </div>

              <ul className="mt-4 space-y-1.5 text-sm">
                {["Best Price Guaranteed", "Instant Confirmation", "Secure Online Payment"].map((b) => (
                  <li key={b} className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-gold shrink-0" />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>

              <Button
                className="mt-5 gold-gradient text-charcoal hover:opacity-90 h-11"
                disabled={busy !== null || !payNowTotal}
                onClick={payNow}
              >
                {busy === "now" ? <Loader2 className="h-4 w-4 animate-spin" /> : `Pay Now · ${inr(payNowTotal)}`}
              </Button>
              <p className="mt-2 text-[10px] text-center text-muted-foreground flex items-center justify-center gap-1">
                <Shield className="h-3 w-3" /> Powered by Razorpay
              </p>
            </div>

            {/* Pay Later */}
            <div className="p-5 flex flex-col">
              <p className="text-xs uppercase tracking-wider text-gold font-medium">Pay Later</p>
              <p className="text-sm text-muted-foreground mt-0.5">Pay at Hotel</p>

              <div className="mt-4">
                {meta.mrp > 0 && (
                  <p className="text-sm text-muted-foreground line-through">{inr(meta.mrp)}</p>
                )}
                <p className="font-display text-3xl text-foreground leading-tight">{inr(payLaterPerNight)}</p>
                <p className="text-[11px] text-muted-foreground">Per night</p>
                <p className="text-[11px] text-muted-foreground">(Inclusive of all taxes)</p>
              </div>

              <ul className="mt-4 space-y-1.5 text-sm">
                {["Reserve Now", "Pay During Check-In", "Flexible"].map((b) => (
                  <li key={b} className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-gold shrink-0" />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>

              <Button
                variant="outline"
                className="mt-5 h-11 border-gold/40"
                disabled={busy !== null || !payLaterTotal}
                onClick={payLater}
              >
                {busy === "later" ? <Loader2 className="h-4 w-4 animate-spin" /> : `Pay Later · ${inr(payLaterTotal)}`}
              </Button>
              <p className="mt-2 text-[10px] text-center text-muted-foreground">
                Pay at the hotel
              </p>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
