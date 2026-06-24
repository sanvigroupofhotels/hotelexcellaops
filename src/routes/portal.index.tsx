/**
 * Guest Portal landing — guest.hotelexcella.in
 * Two ways in:
 *   1. Paste tokenised link/token from confirmation
 *   2. "Find my booking" by booking reference + mobile
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
import { Phone, Mail, MapPin, KeyRound, Search, Loader2 } from "lucide-react";

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
  const [reference, setReference] = useState("");
  const [phone, setPhone] = useState("");
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

  async function findBooking(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!reference.trim() || !phone.trim()) {
      setError("Please enter both booking reference and mobile number.");
      return;
    }
    setSearching(true);
    try {
      const { token: t } = await lookup({ data: { reference: reference.trim(), phone: phone.trim() } });
      navigate({ to: "/portal/$token", params: { token: t } });
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
            Enter your booking reference and the mobile number used at booking.
          </p>
          <form onSubmit={findBooking} className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
            <Input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="Booking reference (e.g. HE-12345)"
              autoComplete="off"
            />
            <Input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Mobile number"
              inputMode="tel"
              autoComplete="tel"
            />
            <Button
              type="submit"
              disabled={searching}
              className="gold-gradient text-charcoal hover:opacity-90 sm:col-span-2"
            >
              {searching ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Search className="h-4 w-4 mr-2" />}
              Find my booking
            </Button>
          </form>
          {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
        </Card>

        <Card className="mt-4 p-5">
          <p className="font-display text-lg flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-gold" /> Open with a link
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Paste the link from your WhatsApp or email confirmation, or just the token.
          </p>
          <div className="mt-3 flex gap-2">
            <Input
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="https://guest.hotelexcella.in/…"
              onKeyDown={(e) => { if (e.key === "Enter") open(); }}
            />
            <Button onClick={open} variant="outline">Open</Button>
          </div>
        </Card>

        <Card className="mt-4 p-5 space-y-2 text-sm">
          <p className="font-display text-lg">Need help?</p>
          {cfg?.hotel.phone ? (
            <a href={`tel:${cfg.hotel.phone}`} className="flex items-center gap-2 text-foreground hover:text-gold">
              <Phone className="h-4 w-4" /> {cfg.hotel.phone}
            </a>
          ) : null}
          {cfg?.hotel.email ? (
            <a href={`mailto:${cfg.hotel.email}`} className="flex items-center gap-2 text-foreground hover:text-gold">
              <Mail className="h-4 w-4" /> {cfg.hotel.email}
            </a>
          ) : null}
          {cfg?.hotel.address ? (
            <p className="flex items-center gap-2 text-muted-foreground">
              <MapPin className="h-4 w-4" /> {cfg.hotel.address}
            </p>
          ) : null}
        </Card>

        <p className="mt-8 text-center text-xs text-muted-foreground">
          Want to make a new booking?{" "}
          <a href="https://book.hotelexcella.in" className="text-gold underline">Book a stay</a>
        </p>
      </main>
    </div>
  );
}
