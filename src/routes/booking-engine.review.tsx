/**
 * Booking Engine — Step 4 (Review your price).
 * Two-column comparison: Pay Now (inventory price) vs Pay Later (inventory + 5%).
 * Includes a collapsible Modify Stay panel that reprices in place without
 * creating a new booking_id.
 */
import { createFileRoute, useNavigate, useSearch, Link } from "@tanstack/react-router";
import { z } from "zod";
import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  getDraftPricing,
  createBookingEngineOrder,
  confirmBookingEnginePayment,
  confirmPayAtHotel,
  updateDraftStay,
} from "@/lib/booking-engine.functions";
import { getRoomMeta } from "@/lib/booking-engine-rooms";
import { useEngineConfig } from "./booking-engine";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ArrowLeft, BedDouble, CalendarDays, Users, Check, Loader2, Shield, Pencil,
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
  const qc = useQueryClient();
  const { data: cfg } = useEngineConfig();
  const [busy, setBusy] = useState<"now" | "later" | null>(null);
  const [modifying, setModifying] = useState(false);

  const getPricing = useServerFn(getDraftPricing);
  const createOrder = useServerFn(createBookingEngineOrder);
  const confirmPay = useServerFn(confirmBookingEnginePayment);
  const confirmPah = useServerFn(confirmPayAtHotel);
  const modifyStay = useServerFn(updateDraftStay);
  

  const q = useQuery({
    queryKey: ["be", "review", search.booking_id],
    queryFn: () => getPricing({ data: { booking_id: search.booking_id } }),
    staleTime: 5_000,
  });

  // Room types from already-fetched engine config (reused — no second fetch).
  const engineCfg = { data: cfg ? { room_types: cfg.room_types as any[] } : undefined, isLoading: !cfg } as { data: { room_types: any[] } | undefined; isLoading: boolean };

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

  // Modify Stay mutation — same booking_id, repriced server-side.
  const modifyMut = useMutation({
    mutationFn: (vars: { check_in: string; check_out: string; guests: number; room_type: string }) =>
      modifyStay({ data: { booking_id: search.booking_id, ...vars } }),
    onSuccess: (_data, vars) => {
      toast.success("Stay updated. Price refreshed.");
      qc.invalidateQueries({ queryKey: ["be", "review", search.booking_id] });
      // Reflect new dates/category in the URL so refresh / share / back-nav stays consistent.
      navigate({
        to: "/booking-engine/review",
        search: { booking_id: search.booking_id, ...vars } as any,
        replace: true,
      });
      setModifying(false);
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not update stay."),
  });

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 pb-12">
      <Link
        to="/booking-engine/checkout"
        search={{
          booking_id: search.booking_id,
          check_in: search.check_in,
          check_out: search.check_out,
          guests: search.guests,
          room_type: search.room_type,
        } as any}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Edit guest details
      </Link>

      <h1 className="mt-3 font-display text-2xl">Review your price</h1>
      <p className="text-sm text-muted-foreground">Choose how you would like to pay.</p>

      {/* Stay summary + Modify */}
      <Card className="mt-4 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <span className="inline-flex items-center gap-1.5"><BedDouble className="h-4 w-4 text-gold" /> {search.room_type}</span>
            <span className="inline-flex items-center gap-1.5"><CalendarDays className="h-4 w-4 text-gold" /> {dateLabel(search.check_in)} → {dateLabel(search.check_out)}</span>
            <span className="inline-flex items-center gap-1.5"><Users className="h-4 w-4 text-gold" /> {search.guests} guest{search.guests > 1 ? "s" : ""}</span>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setModifying((v) => !v)}
            className="shrink-0 gap-1 h-8 text-xs"
          >
            <Pencil className="h-3 w-3" /> {modifying ? "Cancel" : "Modify"}
          </Button>
        </div>
        <div className="mt-3 text-xs text-muted-foreground">
          Check-in from {cfg?.ops.check_in_time ?? "13:00"} · Check-out by {cfg?.ops.check_out_time ?? "11:00"}
        </div>

        {modifying && (
          <ModifyStayPanel
            initial={{
              check_in: search.check_in,
              check_out: search.check_out,
              guests: search.guests,
              room_type: search.room_type,
            }}
            roomTypes={engineCfg.data?.room_types ?? []}
            loading={engineCfg.isLoading}
            submitting={modifyMut.isPending}
            onSubmit={(v) => modifyMut.mutate(v)}
          />
        )}
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

interface ModifyStayValues {
  check_in: string;
  check_out: string;
  guests: number;
  room_type: string;
}
interface RoomTypeOption { type: string; total_rooms: number }

function ModifyStayPanel({
  initial, roomTypes, loading, submitting, onSubmit,
}: {
  initial: ModifyStayValues;
  roomTypes: RoomTypeOption[];
  loading: boolean;
  submitting: boolean;
  onSubmit: (v: ModifyStayValues) => void;
}) {
  const [checkIn, setCheckIn] = useState(initial.check_in);
  const [checkOut, setCheckOut] = useState(initial.check_out);
  const [guests, setGuests] = useState(initial.guests);
  const [roomType, setRoomType] = useState(initial.room_type);

  const dirty =
    checkIn !== initial.check_in ||
    checkOut !== initial.check_out ||
    guests !== initial.guests ||
    roomType !== initial.room_type;

  function submit() {
    if (checkOut <= checkIn) {
      toast.error("Check-out must be after check-in");
      return;
    }
    onSubmit({ check_in: checkIn, check_out: checkOut, guests, room_type: roomType });
  }

  // Build a display list — make sure the current selection is always present
  // even if engine config is still loading.
  const types = (() => {
    const list = (roomTypes ?? []).map((t) => t.type);
    if (initial.room_type && !list.includes(initial.room_type)) list.unshift(initial.room_type);
    return list;
  })();

  return (
    <div className="mt-4 rounded-md border border-gold/30 bg-gold-soft/10 p-3 space-y-3">
      <p className="text-xs uppercase tracking-wider text-gold font-medium">Modify your stay</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label className="text-xs">Check-in</Label>
          <Input type="date" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} />
        </div>
        <div>
          <Label className="text-xs">Check-out</Label>
          <Input type="date" value={checkOut} onChange={(e) => setCheckOut(e.target.value)} min={checkIn} />
        </div>
        <div>
          <Label className="text-xs">Guests</Label>
          <Input
            type="number" min={1} max={10} value={guests}
            onChange={(e) => setGuests(Math.max(1, Math.min(10, Number(e.target.value) || 1)))}
          />
        </div>
        <div>
          <Label className="text-xs">Room category</Label>
          <select
            value={roomType}
            onChange={(e) => setRoomType(e.target.value)}
            disabled={loading}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
          >
            {types.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
      </div>
      <div className="flex justify-end">
        <Button
          type="button"
          onClick={submit}
          disabled={!dirty || submitting}
          size="sm"
          className="gold-gradient text-charcoal hover:opacity-90"
        >
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Update & reprice"}
        </Button>
      </div>
      <p className="text-[10px] text-muted-foreground">
        Your details (name, phone, email, special requests) are preserved.
      </p>
    </div>
  );
}
