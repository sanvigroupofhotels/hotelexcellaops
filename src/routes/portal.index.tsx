/**
 * Guest Portal landing — guest.hotelexcella.in
 * Guests can open with a full link, token, booking reference, or mobile number.
 */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getEngineConfig } from "@/lib/booking-engine.functions";
import { lookupPortalToken } from "@/lib/portal.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Phone, KeyRound, Search, Loader2, MessageCircle, CalendarDays, IndianRupee } from "lucide-react";

type PortalLookupMatch = {
  token: string;
  reference: string;
  guestName: string;
  checkIn: string;
  checkOut: string;
  roomType: string;
  guests: number;
  amount: number;
  status: string;
};

export const Route = createFileRoute("/portal/")({
  component: PortalLanding,
  head: () => ({
    meta: [
      { title: "Guest Portal · Hotel Excella" },
      { name: "description", content: "Manage your booking, upload ID, pay dues, and access in-stay services." },
    ],
  }),
});

function PortalLanding() {
  const navigate = useNavigate();
  const fn = useServerFn(getEngineConfig);
  const lookup = useServerFn(lookupPortalToken);
  const { data: cfg } = useQuery({ queryKey: ["be", "config"], queryFn: () => fn({}), staleTime: 5 * 60_000 });
  const [token, setToken] = useState("");
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<PortalLookupMatch[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function open() {
    const t = token.trim().replace(/^.*\/(?=[a-f0-9]{16,})/i, "");
    if (!/^[a-f0-9]{16,64}$/i.test(t)) {
      alert("Please paste your full booking link or token.");
      return;
    }
    navigate({ to: "/portal/$token", params: { token: t } });
  }

  function openToken(t: string) {
    navigate({ to: "/portal/$token", params: { token: t } });
  }

  async function findBooking(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMatches([]);
    if (!query.trim()) {
      setError("Please enter your booking link, token, reference, or mobile number.");
      return;
    }
    setSearching(true);
    try {
      const res = await lookup({ data: { query: query.trim() } }) as { token?: string | null; matches?: PortalLookupMatch[] };
      if (res.token) {
        openToken(res.token);
        return;
      }
      if (res.matches?.length) {
        setMatches(res.matches);
        return;
      }
      setError("Could not find your booking.");
    } catch (err: any) {
      setError(err?.message ?? "Could not find your booking.");
    } finally {
      setSearching(false);
    }
  }

  const name = cfg?.hotel.name ?? "Hotel Excella";

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto max-w-3xl px-4 py-3 flex items-center gap-2">
          {cfg?.hotel.logo_url
            ? <img src={cfg.hotel.logo_url} alt={name} className="h-9 w-auto" />
            : <span className="font-display text-xl text-gold">{name}</span>}
          <span className="ml-auto text-xs text-muted-foreground">Guest Portal</span>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-10">
        <h1 className="font-display text-3xl">Welcome to {name}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Access your booking, upload your ID, pay any balance, and reach out to reception — all in one place.
        </p>

        <Card className="mt-6 p-5">
          <p className="font-display text-lg flex items-center gap-2">
            <Search className="h-5 w-5 text-gold" /> Find my booking
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Use your portal link, token, booking reference, or mobile number.
          </p>
          <form onSubmit={findBooking} className="mt-3 grid grid-cols-1 gap-2">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Portal link, token, booking ref, or mobile"
              autoComplete="off"
            />
            <Button
              type="submit"
              disabled={searching}
              className="gold-gradient text-charcoal hover:opacity-90"
            >
              {searching ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Search className="h-4 w-4 mr-2" />}
              Find my booking
            </Button>
          </form>
          {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
          {matches.length > 0 && (
            <div className="mt-4 space-y-2">
              <p className="text-xs text-muted-foreground">Multiple active bookings found. Choose the booking you want to open.</p>
              {matches.map((m) => (
                <button
                  key={m.token}
                  type="button"
                  onClick={() => openToken(m.token)}
                  className="w-full rounded-md border border-border bg-card/50 px-3 py-3 text-left hover:border-gold/50 hover:bg-gold-soft/10 transition"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-medium text-sm">{m.guestName || "Guest"}</div>
                    <div className="text-[11px] text-gold font-mono">{m.reference}</div>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                    <span className="inline-flex items-center gap-1"><CalendarDays className="h-3 w-3" /> {fmtDate(m.checkIn)} → {fmtDate(m.checkOut)}</span>
                    <span>{m.roomType || "Room"}</span>
                    <span>{m.guests} guest{m.guests === 1 ? "" : "s"}</span>
                    <span className="inline-flex items-center gap-1"><IndianRupee className="h-3 w-3" /> {Math.round(m.amount || 0).toLocaleString("en-IN")}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </Card>


        <Card className="mt-4 p-5 space-y-3 text-sm">
          <div>
            <p className="font-display text-lg">Need help?</p>
            <p className="text-xs text-muted-foreground mt-1">Call Reception</p>
            <p className="text-base font-medium tabular-nums">+91 9985908131</p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <a href="tel:+919985908131" className="inline-flex items-center justify-center gap-2 rounded-md border border-gold/40 bg-gold-soft/20 px-3 py-2 text-xs hover:bg-gold-soft/30">
              <Phone className="h-3.5 w-3.5 text-gold" /> Call
            </a>
            <a href="https://wa.me/919985908131" target="_blank" rel="noreferrer" className="inline-flex items-center justify-center gap-2 rounded-md border border-success/40 bg-success/10 px-3 py-2 text-xs text-success hover:bg-success/15">
              <MessageCircle className="h-3.5 w-3.5" /> WhatsApp Us
            </a>
          </div>
        </Card>

        <p className="mt-8 text-center text-xs text-muted-foreground">
          Want to make a new booking?{" "}
          <a href="https://book.hotelexcella.in" className="text-gold underline">Book a stay</a>
        </p>
      </main>
    </div>
  );
}

function fmtDate(s: string) {
  if (!s) return "—";
  return new Date(s + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}
