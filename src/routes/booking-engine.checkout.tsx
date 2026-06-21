/**
 * Booking Engine — Step 3 (Guest Details).
 * No pricing shown here. On Proceed:
 *   1. Upsert Lead (best-effort)
 *   2. Create draft booking (creates/links Customer via existing logic; holds inventory)
 *   3. Navigate to Step 4 (Review price & choose payment).
 */
import { createFileRoute, useNavigate, useSearch, Link } from "@tanstack/react-router";
import { z } from "zod";
import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { createDraftBooking } from "@/lib/booking-engine.functions";
import { upsertLeadFromBookingEngine } from "@/lib/leads.functions";
import { useEngineConfig } from "./booking-engine";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, Loader2, BedDouble, CalendarDays, Users } from "lucide-react";

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

  const createDraft = useServerFn(createDraftBooking);
  const upsertLead = useServerFn(upsertLeadFromBookingEngine);

  // Lead capture — debounced; only once per (name, phone, dates, room_type).
  const lastLeadKeyRef = useRef<string>("");
  useEffect(() => {
    const n = name.trim(); const p = phone.trim();
    if (n.length < 2) return;
    if (!/^\+?\d{10,14}$/.test(p)) return;
    const key = `${n}|${p}|${search.check_in}|${search.check_out}|${search.room_type}`;
    if (key === lastLeadKeyRef.current) return;
    const t = setTimeout(() => {
      lastLeadKeyRef.current = key;
      upsertLead({ data: {
        guest_name: n,
        phone: p,
        email: email.trim() || undefined,
        check_in: search.check_in,
        check_out: search.check_out,
        adults: search.guests,
        rooms: 1,
        room_type_name: search.room_type,
      } }).catch(() => { /* best-effort */ });
    }, 900);
    return () => clearTimeout(t);
  }, [name, phone, email, search.check_in, search.check_out, search.room_type, search.guests, upsertLead]);

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
    onSuccess: (r) => {
      navigate({
        to: "/booking-engine/review",
        search: {
          booking_id: r.booking_id,
          room_type: search.room_type,
          check_in: search.check_in,
          check_out: search.check_out,
          guests: search.guests,
        } as any,
      });
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not continue. Please try again."),
  });

  function validate(): boolean {
    if (name.trim().length < 2) { toast.error("Please enter your full name"); return false; }
    if (!/^\+?\d{10,14}$/.test(phone.trim())) { toast.error("Please enter a valid mobile number with country code"); return false; }
    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { toast.error("Please enter a valid email"); return false; }
    return true;
  }

  function proceed() {
    if (!validate()) return;
    draftMut.mutate();
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 pb-32">
      <Link
        to="/booking-engine/search"
        search={{ check_in: search.check_in, check_out: search.check_out, guests: search.guests } as any}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back to rooms
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

      {/* Sticky CTA */}
      <div className="fixed bottom-0 left-0 right-0 border-t border-border bg-background/95 backdrop-blur z-30">
        <div className="mx-auto max-w-3xl px-4 py-3">
          <Button
            onClick={proceed}
            disabled={draftMut.isPending}
            className="w-full gold-gradient text-charcoal hover:opacity-90 h-11"
          >
            {draftMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Proceed →"}
          </Button>
        </div>
      </div>
    </div>
  );
}
