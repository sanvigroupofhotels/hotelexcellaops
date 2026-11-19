import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { BadgeCheck, CalendarDays, MessageCircle, PlayCircle, Users, Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { getAvailability, createWhatsAppDraft, confirmPayAtHotel } from "@/lib/booking-engine.functions";
import { planWhatsAppRooms, type EngineCategory } from "@/lib/whatsapp-booking-selection";
import { fmtINR } from "@/lib/pricing";
import { RECEPTION_WA, waLink } from "@/lib/whatsapp-pitch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EARLY_CHECK_IN_SLOTS, LATE_CHECK_OUT_SLOTS, type EarlyCheckInSlot, type LateCheckOutSlot } from "@/lib/mock-data";
import { bookingTimingLabels } from "@/lib/whatsapp-booking-timing";
import { upsertLeadFromBookingEngine } from "@/lib/leads.functions";
import { canCaptureWhatsAppLead } from "@/lib/whatsapp-lead-capture";

export const Route = createFileRoute("/whatsapp-booking")({
  head: () => ({
    meta: [
      { title: "Book Hotel Excella Vizag on WhatsApp — Best Direct Price" },
      { name: "description", content: "Reserve your room at Hotel Excella, Vizag in one minute. 200 m from the beach, best direct price guaranteed." },
      { property: "og:title", content: "Book Hotel Excella Vizag — Best Direct Price" },
      { property: "og:description", content: "Reserve in one minute and confirm your rate with our front desk on WhatsApp." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: WhatsAppBooking,
});

const TOUR = "https://drive.google.com/file/d/18KMWmFBZO2KnUArLgPYTsn0WICHBPi1h/view?usp=drivesdk";

function iso(days: number) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const d = new Date(today + "T00:00:00");
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function Counter({ label, value, min = 0, max, onChange }: { label: string; value: number; min?: number; max: number; onChange: (value: number) => void }) {
  return <div className="flex items-center gap-2 shrink-0">
    <Button type="button" variant="outline" size="icon" aria-label={`Decrease ${label}`} disabled={value <= min} onClick={() => onChange(value - 1)}><Minus className="h-4 w-4" /></Button>
    <output aria-label={`${label} count`} className="w-7 text-center tabular-nums font-semibold">{value}</output>
    <Button type="button" variant="outline" size="icon" aria-label={`Increase ${label}`} disabled={value >= max} onClick={() => onChange(value + 1)}><Plus className="h-4 w-4" /></Button>
  </div>;
}

function WhatsAppBooking() {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [checkIn, setCheckIn] = useState(iso(0));
  const [checkOut, setCheckOut] = useState(iso(1));
  const [adults, setAdults] = useState(2);
  const [children, setChildren] = useState(0);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [earlySlot, setEarlySlot] = useState<EarlyCheckInSlot | null>(null);
  const [lateSlot, setLateSlot] = useState<LateCheckOutSlot | null>(null);
  const [types, setTypes] = useState<EngineCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [availabilityError, setAvailabilityError] = useState("");
  const selections = types.map((type) => ({ room_type: type.room_type_key, rooms: counts[type.room_type_key] ?? 0 }));
  const roomsReq = selections.reduce((sum, row) => sum + row.rooms, 0);
  let estimate: ReturnType<typeof planWhatsAppRooms> | null = null;
  let selectionError = "";
  if (roomsReq > 0 && !loading) {
    try { estimate = planWhatsAppRooms({ selections, categories: types, adults, children, check_in: checkIn, check_out: checkOut, early: earlySlot, late: lateSlot }); }
    catch (e) { selectionError = e instanceof Error ? e.message : "Please check your room selection."; }
  }
  const [busy, setBusy] = useState(false);
  const [pendingDraft, setPendingDraft] = useState<{ booking_id: string; total: number } | null>(null);
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ ref: string; link: string } | null>(null);
  const captureQueue = useRef<Promise<unknown>>(Promise.resolve());
  const leadPayload = estimate && canCaptureWhatsAppLead(name, phone, roomsReq, checkIn, checkOut) ? JSON.stringify({
    guest_name: name.trim(), phone, check_in: checkIn, check_out: checkOut, adults, children, rooms: roomsReq,
    room_type_name: estimate.summary, estimated_total: estimate.pricing.total, source_channel: "WhatsApp",
    notes: `Unsubmitted WhatsApp quote request. ${bookingTimingLabels(earlySlot, lateSlot).checkIn}; ${bookingTimingLabels(earlySlot, lateSlot).checkOut}`,
  }) : null;
  useEffect(() => {
    if (!leadPayload || done || busy || pendingDraft) return;
    const timer = window.setTimeout(() => {
      captureQueue.current = captureQueue.current.catch(() => undefined).then(() => upsertLeadFromBookingEngine({ data: JSON.parse(leadPayload) }));
      // A failed background capture must not block a guest's booking submission.
      void captureQueue.current.catch(() => undefined);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [leadPayload, done, busy, pendingDraft]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setAvailabilityError("");
    if (checkOut <= checkIn) { setLoading(false); return; }
    getAvailability({ data: { check_in: checkIn, check_out: checkOut, guests: 2 } })
      .then((r) => { if (active) setTypes(r.results); })
      .catch(() => { if (active) { setTypes([]); setAvailabilityError("Availability could not be loaded. Please try again."); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [checkIn, checkOut]);

  async function submit() {
    setError("");
    const digits = phone.replace(/\D/g, "");
    if (name.trim().length < 2) return setError("Please enter your name.");
    if (digits.length < 10) return setError("Please enter a valid 10-digit mobile number.");
    if (checkOut <= checkIn) return setError("Check-out must be after check-in.");
    if (roomsReq < 1) return setError("Please select at least one room.");
    if (!estimate || loading) return setError(selectionError || "Please wait for room availability.");
    const intl = "+" + (digits.length === 10 ? "91" + digits : digits);
    const label = estimate.summary;
    setBusy(true);
    try {
      await captureQueue.current.catch(() => undefined);
      const timing = bookingTimingLabels(earlySlot, lateSlot);
      const draft = pendingDraft ?? await createWhatsAppDraft({
        data: { selections, check_in: checkIn, check_out: checkOut, adults, children, early: earlySlot, late: lateSlot, guest_name: name.trim(), phone: intl },
      });
      setPendingDraft(draft);
      const conf = await confirmPayAtHotel({ data: { booking_id: draft.booking_id } });
      const msg = `Hi Hotel Excella, please send me your best direct quote.\nRef: ${conf.reference}\nName: ${name.trim()}\nMobile: ${digits}\nStay: ${checkIn} to ${checkOut}\nRoom: ${label}\nGuests: ${adults} adults, ${children} children\nPublished rate: ${fmtINR(draft.total)} (incl. GST)\nCheck-in: ${timing.checkIn}\nCheck-out: ${timing.checkOut}\nPlease share your best discounted price.`;
      const link = waLink(RECEPTION_WA, msg);
      setDone({ ref: conf.reference, link });
      window.location.href = link;
    } catch (e: any) {
      setError(e?.message ?? "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-dvh bg-background text-foreground px-4 py-8">
      <div className="mx-auto max-w-md space-y-5">
        <div className="text-center space-y-1">
          <h1 className="font-display text-3xl">Hotel Excella, Vizag</h1>
          <p className="text-sm text-muted-foreground">200 m walk to the beach · Reserve in one minute</p>
        </div>

        <Card className="luxe-card p-4 flex items-start gap-3 border-primary/40">
          <BadgeCheck className="h-5 w-5 text-primary shrink-0 mt-0.5" />
          <div>
            <p className="font-display text-base">Best Price Assured</p>
            <p className="text-xs text-muted-foreground">Reserve now — our front desk shares your exclusive direct rate on WhatsApp.</p>
          </div>
        </Card>

        {done ? (
          <Card className="luxe-card p-5 space-y-3 text-center">
            <p className="font-display text-xl">Your quote request is ready</p>
            <p className="text-sm text-muted-foreground">Reference <span className="font-semibold text-foreground">{done.ref}</span></p>
            <p className="text-sm">Send the WhatsApp message and our Front Desk Reservation Team will reply with your best quote.</p>
            <Button asChild className="w-full"><a href={done.link}><MessageCircle className="h-4 w-4 mr-1" /> Chat on WhatsApp</a></Button>
          </Card>
        ) : (
          <Card className="luxe-card p-5 space-y-4">
            <fieldset disabled={busy || !!pendingDraft} className="space-y-4 border-0 p-0 m-0 min-w-0">
            <div className="space-y-1.5"><Label>Full name</Label><Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></div>
            <div className="space-y-1.5"><Label>Mobile number</Label><Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="10-digit mobile" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label className="flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" />Check-in</Label><Input type="date" min={iso(0)} value={checkIn} onChange={(e) => { setCheckIn(e.target.value); if (checkOut <= e.target.value) { const d = new Date(e.target.value + "T00:00:00"); d.setDate(d.getDate() + 1); setCheckOut(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`); } }} /></div>
              <div className="space-y-1.5"><Label className="flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" />Check-out</Label><Input type="date" min={checkIn} value={checkOut} onChange={(e) => setCheckOut(e.target.value)} /></div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="arrival-slot">Expected check-in time</Label>
              <Select value={earlySlot ?? "standard"} onValueChange={(value) => setEarlySlot(value === "standard" ? null : value as EarlyCheckInSlot)}>
                <SelectTrigger id="arrival-slot" className="w-full h-auto min-h-10 text-left whitespace-normal [&>span]:line-clamp-none"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="standard">Standard (1:00 PM onwards) · Included</SelectItem>
                  {EARLY_CHECK_IN_SLOTS.map((slot) => <SelectItem key={slot.value} value={slot.value}>{slot.label.replace(/\s*\(.*\)/, "")}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="departure-slot">Expected check-out time</Label>
              <Select value={lateSlot ?? "standard"} onValueChange={(value) => setLateSlot(value === "standard" ? null : value as LateCheckOutSlot)}>
                <SelectTrigger id="departure-slot" className="w-full h-auto min-h-10 text-left whitespace-normal [&>span]:line-clamp-none"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="standard">Standard (by 11:00 AM) · Included</SelectItem>
                  {LATE_CHECK_OUT_SLOTS.map((slot) => <SelectItem key={slot.value} value={slot.value}>{slot.label.replace(/\s*\(.*\)/, "")}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Early check-in and late check-out charges are per room, subject to availability. Best Price Assured.</p>
            </div>
            <div className="space-y-3">
              <Label className="flex items-center gap-1"><Users className="h-3.5 w-3.5" />Guests</Label>
              <div className="flex items-center justify-between"><span className="text-sm">Adults</span><Counter label="adults" value={adults} min={1} max={60} onChange={setAdults} /></div>
              <div className="flex items-center justify-between"><span className="text-sm">Children</span><Counter label="children" value={children} max={40} onChange={setChildren} /></div>
            </div>
            <div className="space-y-3">
              <Label>Rooms</Label>
              {loading && <p className="text-xs text-muted-foreground" role="status">Checking availability…</p>}
              {availabilityError && <p className="text-sm text-destructive" role="alert">{availabilityError}</p>}
              {types.map((t) => <div key={t.room_type_key} className="border-b border-border py-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0"><p className="font-medium">{t.type}</p><p className="text-xs text-muted-foreground">{t.available} available</p></div>
                  <Counter label={t.type} value={counts[t.room_type_key] ?? 0} max={Math.min(t.available, 20)} onChange={(value) => setCounts((old) => ({ ...old, [t.room_type_key]: value }))} />
                </div>
                <a href={TOUR} target="_blank" rel="noreferrer" className="text-xs text-primary inline-flex items-center gap-1"><PlayCircle className="h-3.5 w-3.5" />Room tour</a>
              </div>)}
              {!roomsReq && <p className="text-xs text-muted-foreground">Select at least one room.</p>}
              {selectionError && <p className="text-sm text-destructive" role="alert">{selectionError}</p>}
            </div>
            {estimate && <div className="border-t border-border pt-3 space-y-2 text-sm" aria-label="Booking estimate">
              <div className="flex justify-between gap-2"><span>Published tariff · {roomsReq} {roomsReq === 1 ? "room" : "rooms"} (incl. GST)</span><span>{fmtINR(estimate.pricing.mainStayCharges)}</span></div>
              {estimate.pricing.additionalLineItems.map((line) => <div key={line.label} className="flex justify-between gap-3"><span>{line.label}</span><span className="shrink-0">{fmtINR(line.value)}</span></div>)}
              <div className="flex justify-between text-muted-foreground"><span>Base tariff</span><span>{fmtINR(estimate.pricing.subtotal)}</span></div>
              <div className="flex justify-between text-muted-foreground"><span>GST ({Math.round(estimate.pricing.taxRate * 100)}%) included</span><span>{fmtINR(estimate.pricing.taxes)}</span></div>
              <div className="flex justify-between text-base font-semibold"><span>Published rate (incl. GST)</span><span>{fmtINR(estimate.pricing.total)}</span></div>
              <p className="rounded-lg border border-primary/40 bg-primary/10 p-3 text-xs">This is a request form with actual prices, once you submit the request, our Front Desk Team will reply you with a best direct discount for your stay.</p>
            </div>}
            </fieldset>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="sticky bottom-0 bg-card border-t border-border pt-3 pb-1 space-y-2">
            {estimate && <div className="flex justify-between text-sm font-semibold"><span>Published rate (incl. GST)</span><span>{fmtINR(estimate.pricing.total)}</span></div>}
            <Button className="w-full whitespace-normal h-auto min-h-10" onClick={submit} disabled={busy || loading || !estimate}>
              <MessageCircle className="h-4 w-4 mr-1" /> {busy ? "Sending request…" : "Get Best Quote on WhatsApp"}
            </Button>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
