import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { BadgeCheck, CalendarDays, ChevronDown, MessageCircle, PlayCircle, Users, Minus, Plus } from "lucide-react";
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
import { canCaptureWhatsAppLead, canShowWhatsAppPrice } from "@/lib/whatsapp-lead-capture";
import { normalizeOrThrow } from "@/lib/phone";

export const Route = createFileRoute("/whatsapp-booking")({
  head: () => ({
    links: [
      { rel: "canonical", href: "https://book.hotelexcella.in/whatsapp-booking" },
    ],
    meta: [
      { title: "Hotel Excella, Vizag | Hotel Rooms Near Beach Road \u00b7 Best Direct Rates" },
      { name: "description", content: "Book luxury AC rooms directly at Hotel Excella, Visakhapatnam near Beach Road & Tenneti Park. Get instant WhatsApp confirmation, best direct price guarantee, and zero middleman fees." },
      { name: "keywords", content: "hotel near beach road vizag, hotels in vizag near beach, hotel in visakhapatnam, hotel excella vizag, couple friendly hotel vizag, luxury rooms near rk beach vizag, tenneti park hotels, direct hotel booking vizag" },
      { name: "robots", content: "index, follow, max-image-preview:large, max-snippet:-1" },
      { property: "og:title", content: "Hotel Excella, Vizag | Luxury Rooms Near Beach Road \u00b7 Direct Rates" },
      { property: "og:description", content: "Stay near Vizag Beach Road at Hotel Excella. Choose your dates and get your instant direct discount quote on WhatsApp." },
      { property: "og:url", content: "https://book.hotelexcella.in/whatsapp-booking" },
      { property: "og:type", content: "website" },
      { property: "og:image", content: "https://book.hotelexcella.in/og-stay-preview.jpg" },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { property: "og:image:alt", content: "Hotel Excella exterior in Visakhapatnam" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Hotel Excella, Vizag | Rooms Near Beach Road" },
      { name: "twitter:description", content: "Direct WhatsApp booking with best rate guarantee near Vizag Beach Road." },
      { name: "twitter:image", content: "https://book.hotelexcella.in/og-stay-preview.jpg" },
    ],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "Hotel",
          name: "Hotel Excella",
          description: "Boutique luxury hotel in Visakhapatnam near Beach Road offering premium AC rooms, fast Wi-Fi, and 24/7 hospitality.",
          url: "https://book.hotelexcella.in/whatsapp-booking",
          telephone: "+91-9985908131",
          address: {
            "@type": "PostalAddress",
            streetAddress: "386 Revenue Employs Co-operative Society Colony, Vishalakshi Nagar",
            addressLocality: "Visakhapatnam",
            addressRegion: "Andhra Pradesh",
            postalCode: "530043",
            addressCountry: "IN",
          },
          checkinTime: "13:00",
          checkoutTime: "11:00",
          amenityFeature: [
            "Air Conditioning",
            "Free High-Speed Wi-Fi",
            "24/7 Front Desk",
            "Room Service",
            "Power Backup",
          ].map((name) => ({ "@type": "LocationFeatureSpecification", name, value: true })),
        }),
      },
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: [
            {
              "@type": "Question",
              name: "Is Hotel Excella located close to the beach in Visakhapatnam?",
              acceptedAnswer: {
                "@type": "Answer",
                text: "Yes, Hotel Excella offers quick, convenient access to Vizag Beach Road, Tenneti Park, and Kailasagiri, making it ideal for leisure, beach walks, and family trips.",
              },
            },
            {
              "@type": "Question",
              name: "How do I get the lowest room tariff for Hotel Excella Vizag?",
              acceptedAnswer: {
                "@type": "Answer",
                text: "Booking directly through our official WhatsApp form guarantees our best direct price with zero OTA commissions and exclusive complimentary stay perks.",
              },
            },
            {
              "@type": "Question",
              name: "What are the check-in and check-out timings at Hotel Excella?",
              acceptedAnswer: {
                "@type": "Answer",
                text: "Standard check-in is at 1:00 PM and check-out is at 11:00 AM. Early check-in or late check-out can be requested when submitting your WhatsApp booking details.",
              },
            },
            {
              "@type": "Question",
              name: "Are couple-friendly and family bookings accepted?",
              acceptedAnswer: {
                "@type": "Answer",
                text: "Yes, Hotel Excella welcomes families, couples, and corporate travelers with seamless check-in and 24/7 front desk support.",
              },
            },
          ],
        }),
      },
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
  const [capturedPayload, setCapturedPayload] = useState<string | null>(null);
  const [captureError, setCaptureError] = useState("");
  const leadPayload = estimate && canCaptureWhatsAppLead(name, phone, roomsReq, checkIn, checkOut) ? JSON.stringify({
    guest_name: name.trim().length >= 2 ? name.trim() : "WhatsApp enquiry", phone, check_in: checkIn, check_out: checkOut, adults, children, rooms: roomsReq,
    room_type_name: estimate.summary, estimated_total: estimate.pricing.total, source_channel: "WhatsApp",
    notes: `Unsubmitted WhatsApp quote request. ${bookingTimingLabels(earlySlot, lateSlot).checkIn}; ${bookingTimingLabels(earlySlot, lateSlot).checkOut}`,
  }) : null;
  const showPrice = canShowWhatsAppPrice(phone, roomsReq) && !!leadPayload && capturedPayload === leadPayload;
  useEffect(() => {
    if (!leadPayload || done || busy || pendingDraft) return;
    let active = true;
    setCaptureError("");
    const timer = window.setTimeout(() => {
      captureQueue.current = captureQueue.current.catch(() => undefined).then(async () => {
        await upsertLeadFromBookingEngine({ data: JSON.parse(leadPayload) });
        if (active) setCapturedPayload(leadPayload);
      });
      // A failed background capture must not block a guest's booking submission.
      void captureQueue.current.catch(() => { if (active) setCaptureError("Your enquiry could not be saved. Please try again or send your WhatsApp request."); });
    }, 400);
    return () => { active = false; window.clearTimeout(timer); };
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
    if (!canShowWhatsAppPrice(phone, roomsReq) && roomsReq > 0) return setError("Please enter a valid mobile number.");
    if (checkOut <= checkIn) return setError("Check-out must be after check-in.");
    if (roomsReq < 1) return setError("Please select at least one room.");
    if (!estimate || loading) return setError(selectionError || "Please wait for room availability.");
    const intl = normalizeOrThrow(phone);
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
    <div className="min-h-dvh bg-background text-foreground px-4 py-8 animate-in fade-in slide-in-from-bottom-2 duration-500 motion-reduce:animate-none">
      <div className="mx-auto max-w-md space-y-5">
        <header className="flex items-center justify-between gap-3 border-b border-primary/25 pb-4">
          <a href="https://hotelexcella.in" className="group flex min-w-0 items-center gap-3" aria-label="Hotel Excella home">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-primary/50 bg-primary/10 font-display text-xl text-primary" aria-hidden="true">E</span>
            <span className="min-w-0">
              <span className="block font-display text-lg leading-tight text-foreground">Hotel Excella</span>
              <span className="block text-[10px] font-medium uppercase tracking-[0.2em] text-primary">Visakhapatnam</span>
            </span>
          </a>
          <span className="shrink-0 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary">
            Plan your stay
          </span>
        </header>

        <h1 className="font-display text-base leading-tight text-primary">Hotel Excella {"\u00b7"} Rooms in Visakhapatnam Near Beach Road</h1>

        <Card className="luxe-card p-4 flex items-start gap-3 border-primary/40">
          <BadgeCheck className="h-5 w-5 text-primary shrink-0 mt-0.5" />
          <div>
            <p className="font-display text-base">Best Direct Quote</p>
            <p className="text-xs text-muted-foreground">Minutes from Vizag Beach Road. Share your stay dates below to receive an instant direct discount quote directly on WhatsApp.</p>
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
                  <SelectItem value="standard">Standard (1:00 PM onwards) {"\u00b7"} Included</SelectItem>
                  {EARLY_CHECK_IN_SLOTS.map((slot) => <SelectItem key={slot.value} value={slot.value}>{slot.label.replace(/\s*\(.*\)/, "")}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="departure-slot">Expected check-out time</Label>
              <Select value={lateSlot ?? "standard"} onValueChange={(value) => setLateSlot(value === "standard" ? null : value as LateCheckOutSlot)}>
                <SelectTrigger id="departure-slot" className="w-full h-auto min-h-10 text-left whitespace-normal [&>span]:line-clamp-none"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="standard">Standard (by 11:00 AM) {"\u00b7"} Included</SelectItem>
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
              {loading && <p className="text-xs text-muted-foreground" role="status">Checking availability{"\u2026"}</p>}
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
            {estimate && !canShowWhatsAppPrice(phone, roomsReq) && <p className="text-xs text-muted-foreground">Enter a valid mobile number to view your stay total.</p>}
            {leadPayload && !showPrice && !captureError && <p className="text-xs text-muted-foreground" role="status">Saving your enquiry{"\u2026"}</p>}
            {captureError && <p className="text-sm text-destructive" role="alert">{captureError}</p>}
            {estimate && showPrice && <div className="border-t border-border pt-3 space-y-2 text-sm" aria-label="Booking estimate">
              <div className="flex justify-between gap-2"><span>Published tariff {"\u00b7"} {roomsReq} {roomsReq === 1 ? "room" : "rooms"} (incl. GST)</span><span>{fmtINR(estimate.pricing.mainStayCharges)}</span></div>
              {estimate.pricing.additionalLineItems.map((line) => <div key={line.label} className="flex justify-between gap-3"><span>{line.label}</span><span className="shrink-0">{fmtINR(line.value)}</span></div>)}
              <div className="flex justify-between text-muted-foreground"><span>Base tariff</span><span>{fmtINR(estimate.pricing.subtotal)}</span></div>
              <div className="flex justify-between text-muted-foreground"><span>GST ({Math.round(estimate.pricing.taxRate * 100)}%) included</span><span>{fmtINR(estimate.pricing.taxes)}</span></div>
              <div className="flex justify-between text-base font-semibold"><span>Published rate (incl. GST)</span><span>{fmtINR(estimate.pricing.total)}</span></div>
              <p className="rounded-lg border border-primary/40 bg-primary/10 p-3 text-xs">This is a request form with actual prices, once you submit the request, our Front Desk Team will reply you with a best direct discount for your stay.</p>
            </div>}
            </fieldset>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="sticky bottom-0 bg-card border-t border-border pt-3 pb-3 space-y-2" style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom, 0px))" }}>
            {estimate && showPrice && <div className="flex justify-between text-sm font-semibold"><span>Published rate (incl. GST)</span><span>{fmtINR(estimate.pricing.total)}</span></div>}
            <Button className="w-full whitespace-normal h-auto min-h-10" onClick={submit} disabled={busy || loading || !estimate}>
              <MessageCircle className="h-4 w-4 mr-1" /> {busy ? "Sending request\u2026" : "Get Best Quote on WhatsApp"}
            </Button>
            </div>
          </Card>
        )}
        <section aria-labelledby="booking-faq-title" className="space-y-3">
          <h2 id="booking-faq-title" className="font-display text-lg">Hotel Excella booking FAQs</h2>
          <details className="group rounded-lg border border-primary/20 p-3 transition-colors open:bg-primary/5">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium [&::-webkit-details-marker]:hidden"><span>Is Hotel Excella located close to the beach in Visakhapatnam?</span><ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 text-primary transition-transform duration-200 group-open:rotate-180" /></summary>
            <p className="mt-2 text-sm text-muted-foreground">Yes, Hotel Excella offers quick, convenient access to Vizag Beach Road, Tenneti Park, and Kailasagiri, making it ideal for leisure, beach walks, and family trips.</p>
          </details>
          <details className="group rounded-lg border border-primary/20 p-3 transition-colors open:bg-primary/5">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium [&::-webkit-details-marker]:hidden"><span>How do I get the lowest room tariff for Hotel Excella Vizag?</span><ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 text-primary transition-transform duration-200 group-open:rotate-180" /></summary>
            <p className="mt-2 text-sm text-muted-foreground">Booking directly through our official WhatsApp form guarantees our best direct price with zero OTA commissions and exclusive complimentary stay perks.</p>
          </details>
          <details className="group rounded-lg border border-primary/20 p-3 transition-colors open:bg-primary/5">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium [&::-webkit-details-marker]:hidden"><span>What are the check-in and check-out timings at Hotel Excella?</span><ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 text-primary transition-transform duration-200 group-open:rotate-180" /></summary>
            <p className="mt-2 text-sm text-muted-foreground">Standard check-in is at 1:00 PM and check-out is at 11:00 AM. Early check-in or late check-out can be requested when submitting your WhatsApp booking details.</p>
          </details>
          <details className="group rounded-lg border border-primary/20 p-3 transition-colors open:bg-primary/5">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium [&::-webkit-details-marker]:hidden"><span>Are couple-friendly and family bookings accepted?</span><ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 text-primary transition-transform duration-200 group-open:rotate-180" /></summary>
            <p className="mt-2 text-sm text-muted-foreground">Yes, Hotel Excella welcomes families, couples, and corporate travelers with seamless check-in and 24/7 front desk support.</p>
          </details>
        </section>
      </div>
    </div>
  );
}

