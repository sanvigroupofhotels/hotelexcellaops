import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { MessageCircle, Plus, Minus, CalendarDays } from "lucide-react";
import { Topbar } from "@/components/topbar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/_authenticated/utilities/quote-estimator")({ component: QuoteEstimatorPage });

const roomTypes = [
  { key: "oak", label: "Oak Room", base: 2500 },
  { key: "mapple", label: "Mapple Room", base: 3500 },
  { key: "cedar", label: "Cedar Suite", base: 4500 },
] as const;
type RoomKey = (typeof roomTypes)[number]["key"];
const todayInput = (date: Date) => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
};
const tomorrow = () => { const date = new Date(); date.setDate(date.getDate() + 1); return date; };
const inr = (value: number) => "₹" + value.toLocaleString("en-IN", { maximumFractionDigits: 0 });

function QuoteEstimatorPage() {
  const [checkIn, setCheckIn] = useState(todayInput(new Date()));
  const [checkOut, setCheckOut] = useState(todayInput(tomorrow()));
  const [counts, setCounts] = useState<Record<RoomKey, number>>({ oak: 0, mapple: 0, cedar: 0 });
  const [rates, setRates] = useState<Record<RoomKey, number>>({ oak: 2500, mapple: 3500, cedar: 4500 });
  const [extraAdults, setExtraAdults] = useState(0);
  const [children, setChildren] = useState(0);
  const [early, setEarly] = useState(false);
  const [late, setLate] = useState(false);
  const nights = useMemo(() => {
    const start = new Date(checkIn + "T00:00:00").getTime();
    const end = new Date(checkOut + "T00:00:00").getTime();
    return Number.isFinite(start) && Number.isFinite(end) ? Math.max(1, Math.ceil((end - start) / 86_400_000)) : 1;
  }, [checkIn, checkOut]);
  const summary = useMemo(() => {
    const roomRent = roomTypes.reduce((sum, room) => sum + counts[room.key] * rates[room.key] * nights, 0);
    const extraCharge = extraAdults * 500 * nights;
    const timingCharge = (Number(early) + Number(late)) * 500;
    const subtotal = roomRent + extraCharge + timingCharge;
    // Estimate each room category at its own accommodation slab; add-ons follow the selected room-rate slab.
    const roomTax = roomTypes.reduce((sum, room) => {
      const line = counts[room.key] * rates[room.key] * nights;
      return sum + line * (rates[room.key] >= 7500 ? 0.18 : 0.05);
    }, 0);
    const roomCount = roomTypes.reduce((sum, room) => sum + counts[room.key], 0);
    const addOnTax = roomCount > 0 ? roomTypes.reduce((sum, room) => {
      const share = counts[room.key] / roomCount;
      const rate = rates[room.key] >= 7500 ? 0.18 : 0.05;
      return sum + (extraCharge + timingCharge) * share * rate;
    }, 0) : 0;
    const gst = roomTax + addOnTax;
    return { roomRent, extraCharge, timingCharge, subtotal, gst, total: subtotal + gst };
  }, [counts, rates, nights, extraAdults, early, late]);

  const adjustCount = (key: RoomKey, amount: number) => setCounts((current) => ({ ...current, [key]: Math.max(0, current[key] + amount) }));
  const quoteText = [
    "✨ HOTEL EXCELLA — STAY QUOTE ✨",
    "Check-in: " + displayDate(checkIn) + " | Check-out: " + displayDate(checkOut) + " (" + nights + (nights === 1 ? " night)" : " nights)"),
    ...roomTypes.filter((room) => counts[room.key] > 0).map((room) => counts[room.key] + " × " + room.label + " · " + inr(rates[room.key]) + "/night"),
    "Room rent: " + inr(summary.roomRent),
    ...(summary.extraCharge ? ["Extra adults: " + inr(summary.extraCharge)] : []),
    ...(summary.timingCharge ? ["Timing charges: " + inr(summary.timingCharge)] : []),
    "Estimated GST: " + inr(summary.gst),
    "Estimated total: " + inr(summary.total),
    "Children: " + children + " (subject to hotel policy)",
    "For availability and confirmation, contact reception: +91 9985908131",
    "Rates are an estimate and subject to availability and applicable taxes.",
  ].join("\n");
  const shareQuote = () => window.open("https://wa.me/?text=" + encodeURIComponent(quoteText), "_blank", "noopener,noreferrer");

  return (
    <div>
      <Topbar title="Stay Quote Estimator" subtitle="Prepare a quick indicative quote for a guest" />
      <main className="mx-auto grid max-w-6xl gap-4 p-4 lg:grid-cols-[1.1fr_0.9fr] lg:p-6">
        <section className="luxe-card space-y-5 rounded-xl p-4 md:p-6">
          <div className="flex items-center gap-2 font-display text-lg"><CalendarDays className="h-5 w-5 text-gold" />Stay details</div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="space-y-1.5 text-sm"><span>Check-in</span><Input type="date" value={checkIn} onChange={(event) => { const value = event.target.value; setCheckIn(value); if (value && value >= checkOut) { const next = new Date(value + "T00:00:00"); next.setDate(next.getDate() + 1); setCheckOut(todayInput(next)); } }} /></label>
            <label className="space-y-1.5 text-sm"><span>Check-out</span><Input type="date" min={checkIn} value={checkOut} onChange={(event) => setCheckOut(event.target.value)} /></label>
          </div>
          <div className="rounded-lg border border-gold/30 bg-gold-soft/30 px-3 py-2 text-sm">{nights} {nights === 1 ? "night" : "nights"}</div>
          <div className="space-y-3">
            <div className="text-sm font-medium">Rooms and nightly rates</div>
            {roomTypes.map((room) => <div key={room.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-border/60 p-3">
              <div className="min-w-0"><div className="font-medium">{room.label}</div><label className="mt-1 flex max-w-44 items-center gap-1 text-xs text-muted-foreground">₹ <Input aria-label={room.label + " nightly tariff"} className="h-8" type="number" min="0" step="100" value={rates[room.key]} onChange={(event) => setRates((current) => ({ ...current, [room.key]: Math.max(0, Number(event.target.value) || 0) }))} /> / night</label></div>
              <div className="flex items-center gap-2"><Button size="icon" variant="outline" aria-label={"Remove one " + room.label} onClick={() => adjustCount(room.key, -1)}><Minus className="h-4 w-4" /></Button><span className="w-5 text-center tabular-nums">{counts[room.key]}</span><Button size="icon" variant="outline" aria-label={"Add one " + room.label} onClick={() => adjustCount(room.key, 1)}><Plus className="h-4 w-4" /></Button></div>
            </div>)}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <CountControl label="Extra adults · ₹500/night" value={extraAdults} onChange={setExtraAdults} />
            <CountControl label="Children · no add-on included" value={children} onChange={setChildren} />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-border/60 px-3 text-sm"><input type="checkbox" checked={early} onChange={(event) => setEarly(event.target.checked)} />Early check-in before 12 PM (+₹500)</label>
            <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-border/60 px-3 text-sm"><input type="checkbox" checked={late} onChange={(event) => setLate(event.target.checked)} />Late checkout after 11 AM (+₹500)</label>
          </div>
        </section>
        <section className="luxe-card flex flex-col rounded-xl p-4 md:p-6">
          <div className="text-xs uppercase tracking-[0.18em] text-gold">Quote summary</div>
          <div className="mt-4 flex-1 space-y-3 text-sm">
            <SummaryLine label={"Room rent · " + nights + " nights"} value={inr(summary.roomRent)} />
            {summary.extraCharge > 0 && <SummaryLine label="Extra adults" value={inr(summary.extraCharge)} />}
            {early && <SummaryLine label="Early check-in" value={inr(500)} />}
            {late && <SummaryLine label="Late checkout" value={inr(500)} />}
            <SummaryLine label="Subtotal" value={inr(summary.subtotal)} />
            <SummaryLine label="Estimated GST" value={inr(summary.gst)} />
            <div className="border-t border-border pt-3"><SummaryLine label="Estimated total" value={inr(summary.total)} strong /></div>
            {children > 0 && <p className="text-xs text-muted-foreground">Children: {children} · included without an added charge in this estimate.</p>}
            <p className="text-[11px] leading-relaxed text-muted-foreground">Estimate assumes 5% GST without ITC for room rates up to ₹7,500/night and 18% with ITC above that threshold. Confirm the hotel’s registered tax treatment and child policy before quoting.</p>
          </div>
          <Button className="mt-5 w-full" onClick={shareQuote} disabled={!roomTypes.some((room) => counts[room.key] > 0)}><MessageCircle className="mr-2 h-4 w-4" />Share quote on WhatsApp</Button>
        </section>
      </main>
    </div>
  );
}

function CountControl({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return <label className="space-y-1.5 text-xs text-muted-foreground"><span>{label}</span><Input type="number" min="0" step="1" value={value} onChange={(event) => onChange(Math.max(0, Math.floor(Number(event.target.value) || 0)))} /></label>;
}

function SummaryLine({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return <div className={"flex items-center justify-between gap-3 " + (strong ? "font-semibold" : "")}><span className={strong ? "text-base" : "text-muted-foreground"}>{label}</span><span className={strong ? "text-lg text-gold" : "tabular-nums"}>{value}</span></div>;
}

function displayDate(value: string): string {
  const date = new Date(value + "T00:00:00");
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}
