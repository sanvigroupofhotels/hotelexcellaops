/**
 * Booking Engine — Step 3 (Guest Details).
 * Two modes:
 *   - Fresh:    no booking_id → upserts lead, creates new draft booking on Proceed.
 *   - Rehydrate: ?booking_id=… → loads guest details for editing; on Proceed,
 *                updates the SAME booking and navigates to Review.
 */
import { createFileRoute, useNavigate, useSearch, Link } from "@tanstack/react-router";
import { z } from "zod";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  createDraftBooking,
  getDraftBookingForCheckout,
  updateDraftGuestDetails,
} from "@/lib/booking-engine.functions";
import { upsertLeadFromBookingEngine } from "@/lib/leads.functions";
import { useEngineConfig } from "./booking-engine";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, Loader2, BedDouble, CalendarDays, Users } from "lucide-react";

const Schema = z.object({
  check_in: z.string().optional(),
  check_out: z.string().optional(),
  guests: z.coerce.number().int().min(1).max(10).optional(),
  room_type: z.string().optional(),
  booking_id: z.string().uuid().optional(),
});

export const Route = createFileRoute("/booking-engine/checkout")({
  component: CheckoutPage,
  validateSearch: (raw) => Schema.parse(raw),
});

const dateLabel = (iso: string) =>
  new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short", year: "numeric" });

function CheckoutPage() {
  const search = useSearch({ from: "/booking-engine/checkout" });
  const navigate = useNavigate();
  const { data: cfg } = useEngineConfig();

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("+91");
  const [email, setEmail] = useState("");
  const [requests, setRequests] = useState("");
  const [hydrated, setHydrated] = useState(false);

  const createDraft = useServerFn(createDraftBooking);
  const updateGuest = useServerFn(updateDraftGuestDetails);
  const upsertLead = useServerFn(upsertLeadFromBookingEngine);
  const getDraft = useServerFn(getDraftBookingForCheckout);

  // Rehydrate from existing draft (back-nav from Review)
  const rehydrate = useQuery({
    queryKey: ["be-draft-rehydrate", search.booking_id],
    queryFn: () => getDraft({ data: { booking_id: search.booking_id! } }),
    enabled: !!search.booking_id,
    staleTime: 5_000,
  });
  useEffect(() => {
    if (rehydrate.data && !hydrated) {
      setName(rehydrate.data.guest_name || "");
      setPhone(rehydrate.data.phone || "+91");
      setEmail(rehydrate.data.email || "");
      setRequests(rehydrate.data.special_requests || "");
      setHydrated(true);
    }
  }, [rehydrate.data, hydrated]);

  // Effective stay context — prefer rehydrated booking values when available.
  const stay = {
    check_in: rehydrate.data?.check_in ?? search.check_in ?? "",
    check_out: rehydrate.data?.check_out ?? search.check_out ?? "",
    guests: Number(rehydrate.data?.guests ?? search.guests ?? 2),
    room_type: rehydrate.data?.room_type ?? search.room_type ?? "",
  };

  // Lead capture (fresh mode only). Debounced; one-shot per key.
  const lastLeadKeyRef = useRef<string>("");
  useEffect(() => {
    if (search.booking_id) return; // editing existing draft — leads already captured
    const n = name.trim(); const p = phone.trim();
    if (n.length < 2) return;
    if (!/^\+?\d{10,14}$/.test(p)) return;
    if (!stay.check_in || !stay.check_out || !stay.room_type) return;
    const key = `${n}|${p}|${stay.check_in}|${stay.check_out}|${stay.room_type}`;
    if (key === lastLeadKeyRef.current) return;
    const t = setTimeout(() => {
      lastLeadKeyRef.current = key;
      upsertLead({ data: {
        guest_name: n, phone: p, email: email.trim() || undefined,
        check_in: stay.check_in, check_out: stay.check_out,
        adults: stay.guests, rooms: 1, room_type_name: stay.room_type,
      } }).catch(() => { /* best-effort */ });
    }, 900);
    return () => clearTimeout(t);
  }, [name, phone, email, stay.check_in, stay.check_out, stay.room_type, stay.guests, upsertLead, search.booking_id]);

  const draftMut = useMutation({
    mutationFn: async () => {
      // Editing an existing draft — just save updates and proceed.
      if (search.booking_id) {
        await updateGuest({ data: {
          booking_id: search.booking_id,
          guest_name: name.trim(),
          phone: phone.trim(),
          email: email.trim(),
          special_requests: requests.trim(),
        } });
        return { booking_id: search.booking_id };
      }
      // Fresh draft creation
      const r = await createDraft({ data: {
        room_type: stay.room_type,
        check_in: stay.check_in,
        check_out: stay.check_out,
        guests: stay.guests,
        guest_name: name.trim(),
        phone: phone.trim(),
        email: email.trim(),
        special_requests: requests.trim(),
      } });
      return { booking_id: r.booking_id };
    },
    onSuccess: (r) => {
      navigate({
        to: "/booking-engine/review",
        search: {
          booking_id: r.booking_id,
          room_type: stay.room_type,
          check_in: stay.check_in,
          check_out: stay.check_out,
          guests: stay.guests,
        } as any,
      });
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not continue. Please try again."),
  });

  function validate(): boolean {
    if (name.trim().length < 2) { toast.error("Please enter your full name"); return false; }
    if (!/^\+?\d{10,14}$/.test(phone.trim())) { toast.error("Please enter a valid mobile number with country code"); return false; }
    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { toast.error("Please enter a valid email"); return false; }
    if (!stay.check_in || !stay.check_out || !stay.room_type) { toast.error("Stay details missing. Please go back to search."); return false; }
    return true;
  }

  function proceed() {
    if (!validate()) return;
    draftMut.mutate();
  }

  const loading = !!search.booking_id && rehydrate.isLoading;

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 pb-32">
      <Link
        to={search.booking_id ? "/booking-engine/review" : "/booking-engine/search"}
        search={search.booking_id
          ? { booking_id: search.booking_id, room_type: stay.room_type, check_in: stay.check_in, check_out: stay.check_out, guests: stay.guests } as any
          : { check_in: stay.check_in, check_out: stay.check_out, guests: stay.guests } as any}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back
      </Link>

      <h1 className="mt-3 font-display text-2xl">
        {search.booking_id ? "Edit your details" : "Complete your booking"}
      </h1>

      {/* Stay summary */}
      {loading ? (
        <Card className="mt-4 p-8 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></Card>
      ) : (
        <>
          <Card className="mt-4 p-4">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              <span className="inline-flex items-center gap-1.5"><BedDouble className="h-4 w-4 text-gold" /> {stay.room_type}</span>
              <span className="inline-flex items-center gap-1.5"><CalendarDays className="h-4 w-4 text-gold" /> {dateLabel(stay.check_in)} → {dateLabel(stay.check_out)}</span>
              <span className="inline-flex items-center gap-1.5"><Users className="h-4 w-4 text-gold" /> {stay.guests} guest{stay.guests > 1 ? "s" : ""}</span>
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
                <Label className="text-xs">Full Name *</Label>
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
              <Label className="text-xs">Special Requests</Label>
              <Textarea value={requests} onChange={(e) => setRequests(e.target.value)} placeholder="Early check-in, high floor, etc. (optional)" rows={2} />
            </div>
          </Card>
        </>
      )}

      {/* Sticky CTA */}
      <div className="fixed bottom-0 left-0 right-0 border-t border-border bg-background/95 backdrop-blur z-30">
        <div className="mx-auto max-w-3xl px-4 py-3">
          <Button
            onClick={proceed}
            disabled={draftMut.isPending || loading}
            className="w-full gold-gradient text-charcoal hover:opacity-90 h-11"
          >
            {draftMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Proceed →"}
          </Button>
        </div>
      </div>
    </div>
  );
}
