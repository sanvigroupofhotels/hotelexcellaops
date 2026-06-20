/**
 * Booking Engine — checkout.
 * Single-scroll: guest details → price summary → Pay Now (Razorpay) / Pay at Hotel.
 * On createDraftBooking, a 15-minute hold reserves inventory.
 */
import { createFileRoute, useNavigate, useSearch, Link } from "@tanstack/react-router";
import { z } from "zod";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  createDraftBooking,
  createBookingEngineOrder,
  confirmBookingEnginePayment,
  confirmPayAtHotel,
} from "@/lib/booking-engine.functions";
import { useEngineConfig } from "./be";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, Clock, Loader2, Shield, BedDouble, CalendarDays, Users } from "lucide-react";

const Schema = z.object({
  check_in: z.string(),
  check_out: z.string(),
  guests: z.coerce.number().int().min(1).max(10),
  room_type: z.string(),
});

export const Route = createFileRoute("/booking-engine/checkout")({
  component: CheckoutPage,
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

function CheckoutPage() {
  const search = useSearch({ from: "/booking-engine/checkout" });
  const navigate = useNavigate();
  const { data: cfg } = useEngineConfig();

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("+91");
  const [email, setEmail] = useState("");
  const [requests, setRequests] = useState("");
  const [draft, setDraft] = useState<{ booking_id: string; reference: string; total: number; subtotal: number; taxes: number; tax_rate: number; nights: number; draft_expires_at: string } | null>(null);
  const [remainingSec, setRemainingSec] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  // Razorpay script
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.Razorpay) return;
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.async = true;
    document.body.appendChild(s);
  }, []);

  // Hold-timer
  useEffect(() => {
    if (!draft) return;
    const tick = () => {
      const ms = new Date(draft.draft_expires_at).getTime() - Date.now();
      setRemainingSec(Math.max(0, Math.round(ms / 1000)));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [draft]);

  const createDraft = useServerFn(createDraftBooking);
  const createOrder = useServerFn(createBookingEngineOrder);
  const confirmPay = useServerFn(confirmBookingEnginePayment);
  const confirmPah = useServerFn(confirmPayAtHotel);

  const draftMut = useMutation({
    mutationFn: () =>
      createDraft({
        data: {
          room_type: search.room_type,
          check_in: search.check_in,
          check_out: search.check_out,
          guests: search.guests,
          guest_name: name.trim(),
          phone: phone.trim(),
          email: email.trim(),
          special_requests: requests.trim(),
        },
      }),
    onSuccess: (r) => setDraft(r),
    onError: (e: any) => toast.error(e?.message ?? "Could not hold this room. Please try again."),
  });

  function validate(): boolean {
    if (name.trim().length < 2) { toast.error("Please enter your full name"); return false; }
    if (!/^\+?\d{10,14}$/.test(phone.trim())) { toast.error("Please enter a valid mobile number with country code"); return false; }
    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { toast.error("Please enter a valid email"); return false; }
    return true;
  }

  async function ensureDraft(): Promise<typeof draft> {
    if (draft) return draft;
    if (!validate()) return null;
    const r = await draftMut.mutateAsync();
    return r;
  }

  async function payNow() {
    setBusy(true);
    try {
      const d = await ensureDraft();
      if (!d) return;
      const order = await createOrder({ data: { booking_id: d.booking_id, intent: "full", amount: d.total } });

      await new Promise<void>((resolve) => {
        // Wait for SDK
        let tries = 0;
        const wait = () => {
          if (window.Razorpay) return resolve();
          if (++tries > 40) return resolve();
          setTimeout(wait, 50);
        };
        wait();
      });

      if (!window.Razorpay) {
        toast.error("Payment SDK could not load. Please try again or choose Pay at Hotel.");
        return;
      }

      const rz = new window.Razorpay({
        key: order.keyId,
        order_id: order.orderId,
        amount: order.amount,
        currency: order.currency,
        name: cfg?.hotel.name || "Hotel Excella",
        description: `Booking ${order.bookingReference}`,
        prefill: { name: order.guestName, contact: order.phone, email },
        theme: { color: "#caa264" },
        handler: async (resp: any) => {
          try {
            const r = await confirmPay({
              data: {
                booking_id: d.booking_id,
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
        modal: { ondismiss: () => setBusy(false) },
      });
      rz.open();
    } catch (e: any) {
      toast.error(e?.message ?? "Could not initiate payment");
    } finally {
      setBusy(false);
    }
  }

  async function payAtHotel() {
    setBusy(true);
    try {
      const d = await ensureDraft();
      if (!d) return;
      const r = await confirmPah({ data: { booking_id: d.booking_id } });
      navigate({ to: "/booking-engine/confirmation/$ref", params: { ref: r.reference } });
    } catch (e: any) {
      toast.error(e?.message ?? "Could not confirm. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const mm = remainingSec != null ? String(Math.floor(remainingSec / 60)).padStart(2, "0") : "--";
  const ss = remainingSec != null ? String(remainingSec % 60).padStart(2, "0") : "--";

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 pb-32">
      <Link to="/booking-engine/search" search={{ check_in: search.check_in, check_out: search.check_out, guests: search.guests } as any}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to results
      </Link>

      <h1 className="mt-3 font-display text-2xl">Complete your booking</h1>

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

      {/* Guest details */}
      <Card className="mt-4 p-4 space-y-3">
        <p className="font-display text-lg">Guest details</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label className="text-xs">Full name *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="As per ID" autoComplete="name" />
          </div>
          <div>
            <Label className="text-xs">Mobile *</Label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 9XXXXXXXXX" inputMode="tel" autoComplete="tel" />
          </div>
          <div>
            <Label className="text-xs">Email</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="optional" autoComplete="email" />
          </div>
        </div>
        <div>
          <Label className="text-xs">Special requests</Label>
          <Textarea value={requests} onChange={(e) => setRequests(e.target.value)} placeholder="Early check-in, high floor, etc. (optional)" rows={2} />
        </div>
      </Card>

      {/* Hold notice */}
      {draft && remainingSec !== null && remainingSec > 0 && (
        <Card className="mt-4 p-3 flex items-center gap-2 border-gold/40 bg-gold/5">
          <Clock className="h-4 w-4 text-gold" />
          <span className="text-sm">
            This room is reserved for you for the next <b>{mm}:{ss}</b>.
          </span>
        </Card>
      )}

      {/* Price summary */}
      <Card className="mt-4 p-4">
        <p className="font-display text-lg">Price summary</p>
        {!draft ? (
          <p className="mt-2 text-sm text-muted-foreground">
            Enter your details and continue to see the final amount and payment options.
          </p>
        ) : (
          <div className="mt-3 space-y-1 text-sm">
            <div className="flex justify-between">
              <span>{draft.nights} night{draft.nights > 1 ? "s" : ""} × {search.room_type}</span>
              <span>{inr(draft.subtotal)}</span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>Taxes ({Math.round(draft.tax_rate * 100)}%)</span>
              <span>{inr(draft.taxes)}</span>
            </div>
            <div className="flex justify-between font-medium pt-2 border-t border-border mt-2 text-base">
              <span>Grand Total</span>
              <span>{inr(draft.total)}</span>
            </div>
          </div>
        )}
      </Card>

      {/* Sticky CTA */}
      <div className="fixed bottom-0 left-0 right-0 border-t border-border bg-background/95 backdrop-blur z-30">
        <div className="mx-auto max-w-3xl px-4 py-3 flex flex-col sm:flex-row gap-2">
          {cfg?.payment.allow_full_payment !== false && (
            <Button
              onClick={payNow}
              disabled={busy || draftMut.isPending}
              className="flex-1 gold-gradient text-charcoal hover:opacity-90 h-11"
            >
              {busy || draftMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Pay Now {draft ? `· ${inr(draft.total)}` : ""}</>}
            </Button>
          )}
          {cfg?.payment.allow_pay_at_hotel !== false && (
            <Button
              variant="outline"
              onClick={payAtHotel}
              disabled={busy || draftMut.isPending}
              className="flex-1 h-11 border-gold/40"
            >
              {busy || draftMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Pay at Hotel"}
            </Button>
          )}
        </div>
        <p className="text-[10px] text-center text-muted-foreground pb-2 flex items-center justify-center gap-1">
          <Shield className="h-3 w-3" /> Secure payments by Razorpay · TLS encrypted
        </p>
      </div>
    </div>
  );
}
