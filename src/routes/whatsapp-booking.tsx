import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { BadgeCheck, CalendarDays, MessageCircle, PlayCircle, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { getAvailability, createDraftBooking, confirmPayAtHotel } from "@/lib/booking-engine.functions";
import { upsertLeadFromBookingEngine } from "@/lib/leads.functions";
import { RECEPTION_WA, waLink } from "@/lib/whatsapp-pitch";

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
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

type Avail = { type: string; room_type_key: string; available: number };

function WhatsAppBooking() {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [checkIn, setCheckIn] = useState(iso(0));
  const [checkOut, setCheckOut] = useState(iso(1));
  const [guestsStr, setGuestsStr] = useState("2");
  const [roomsStr, setRoomsStr] = useState("1");
  const guests = Math.max(1, Math.min(10, parseInt(guestsStr) || 1));
  const roomsReq = Math.max(1, Math.min(20, parseInt(roomsStr) || 1));
  const [types, setTypes] = useState<Avail[]>([]);
  const [roomType, setRoomType] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ ref: string; link: string } | null>(null);

  useEffect(() => {
    if (checkOut <= checkIn) return;
    getAvailability({ data: { check_in: checkIn, check_out: checkOut, guests } })
      .then((r) => {
        const list = r.results as Avail[];
        setTypes(list);
        if (!list.find((t) => t.room_type_key === roomType && t.available > 0)) {
          setRoomType(list.find((t) => t.available > 0)?.room_type_key ?? "");
        }
      })
      .catch(() => setTypes([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkIn, checkOut, guests]);

  async function submit() {
    setError("");
    const digits = phone.replace(/\D/g, "");
    if (name.trim().length < 2) return setError("Please enter your name.");
    if (digits.length < 10) return setError("Please enter a valid 10-digit mobile number.");
    if (checkOut <= checkIn) return setError("Check-out must be after check-in.");
    if (!roomType) return setError("No rooms available for these dates. Please message us on WhatsApp.");
    const intl = "+" + (digits.length === 10 ? "91" + digits : digits);
    const label = types.find((t) => t.room_type_key === roomType)?.type ?? roomType;
    setBusy(true);
    try {
      upsertLeadFromBookingEngine({
        data: { guest_name: name.trim(), phone: intl, check_in: checkIn, check_out: checkOut, adults: guests, room_type_name: label, notes: `WhatsApp booking form — ${roomsReq} room(s) for ${guests} guest(s)` },
      }).catch(() => {});
      const draft = await createDraftBooking({
        data: { room_type: roomType, check_in: checkIn, check_out: checkOut, guests, rooms: roomsReq, guest_name: name.trim(), phone: intl, special_requests: `Via WhatsApp booking form — ${roomsReq} room(s) requested for ${guests} guest(s); rate to be confirmed by front desk` },
      });
      const conf = await confirmPayAtHotel({ data: { booking_id: draft.booking_id } });
      const msg = `Hi Hotel Excella, I just reserved via WhatsApp booking.\nRef: ${conf.reference}\nName: ${name.trim()}\nMobile: ${digits}\nStay: ${checkIn} to ${checkOut}\nRoom: ${label}\nGuests: ${guests}\nPlease confirm my best direct price.`;
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
            <p className="font-display text-base">Best Direct Price Guarantee</p>
            <p className="text-xs text-muted-foreground">Reserve now — our front desk shares your exclusive direct rate on WhatsApp.</p>
          </div>
        </Card>

        {done ? (
          <Card className="luxe-card p-5 space-y-3 text-center">
            <p className="font-display text-xl">Your room is reserved</p>
            <p className="text-sm text-muted-foreground">Reference <span className="font-semibold text-foreground">{done.ref}</span></p>
            <p className="text-sm">Please send the WhatsApp message so we can confirm your price.</p>
            <Button asChild className="w-full"><a href={done.link}><MessageCircle className="h-4 w-4 mr-1" /> Chat on WhatsApp</a></Button>
          </Card>
        ) : (
          <Card className="luxe-card p-5 space-y-4">
            <div className="space-y-1.5"><Label>Full name</Label><Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></div>
            <div className="space-y-1.5"><Label>Mobile number</Label><Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="10-digit mobile" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label className="flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" />Check-in</Label><Input type="date" min={iso(0)} value={checkIn} onChange={(e) => { setCheckIn(e.target.value); if (checkOut <= e.target.value) { const d = new Date(e.target.value + "T00:00:00"); d.setDate(d.getDate() + 1); setCheckOut(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`); } }} /></div>
              <div className="space-y-1.5"><Label className="flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" />Check-out</Label><Input type="date" min={checkIn} value={checkOut} onChange={(e) => setCheckOut(e.target.value)} /></div>
            </div>
            <div className="space-y-1.5"><Label className="flex items-center gap-1"><Users className="h-3.5 w-3.5" />Guests</Label><Input type="number" inputMode="numeric" min={1} max={10} value={guestsStr} onChange={(e) => setGuestsStr(e.target.value.replace(/\D/g, "").slice(0, 2))} onBlur={() => setGuestsStr(String(guests))} /></div>
            <div className="space-y-1.5">
              <Label>Room type</Label>
              <div className="grid gap-2">
                {types.length === 0 && <p className="text-xs text-muted-foreground">Checking availability…</p>}
                {types.map((t) => (
                  <button
                    key={t.room_type_key}
                    disabled={t.available <= 0}
                    onClick={() => setRoomType(t.room_type_key)}
                    className={`flex items-center justify-between rounded-md border px-3 py-2 text-sm text-left disabled:opacity-40 ${roomType === t.room_type_key ? "border-primary bg-primary/10" : "border-border"}`}
                  >
                    <span>{t.type} <span className="text-xs text-muted-foreground">— {t.available > 0 ? `${t.available} available` : "sold out"}</span></span>
                    <a href={TOUR} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-xs text-primary flex items-center gap-1"><PlayCircle className="h-3.5 w-3.5" />Tour</a>
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Number of rooms</Label>
              <Input type="number" inputMode="numeric" min={1} value={roomsStr} onChange={(e) => setRoomsStr(e.target.value.replace(/\D/g, "").slice(0, 2))} onBlur={() => setRoomsStr(String(roomsReq))} />
              {(() => { const sel = types.find((t) => t.room_type_key === roomType); return sel ? (
                <p className="text-xs text-muted-foreground">{sel.type}: {sel.available} room(s) available for these dates{roomsReq > sel.available ? " — we'll confirm the extra rooms with you on WhatsApp." : ""}</p>
              ) : null; })()}
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button className="w-full" onClick={submit} disabled={busy}>
              <MessageCircle className="h-4 w-4 mr-1" /> {busy ? "Reserving…" : "Reserve & continue on WhatsApp"}
            </Button>
          </Card>
        )}
      </div>
    </div>
  );
}
