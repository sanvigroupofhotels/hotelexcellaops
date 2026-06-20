/**
 * Guest Portal landing — guest.hotelexcella.in
 * Splash with "Enter your booking link" + contact reception.
 * If a token is entered, navigate to /portal/<token>.
 */
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getEngineConfig } from "@/lib/booking-engine.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Phone, Mail, MapPin, KeyRound } from "lucide-react";

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
  const { data: cfg } = useQuery({ queryKey: ["be", "config"], queryFn: () => fn({}), staleTime: 5 * 60_000 });
  const [token, setToken] = useState("");

  function open() {
    const t = token.trim().replace(/^.*\/(?=[a-f0-9]{16,})/i, "");
    if (!/^[a-f0-9]{16,64}$/i.test(t)) {
      alert("Please paste your full booking link or token.");
      return;
    }
    navigate({ to: "/portal/$token", params: { token: t } });
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
            <KeyRound className="h-5 w-5 text-gold" /> Open your booking
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
            <Button onClick={open} className="gold-gradient text-charcoal hover:opacity-90">Open</Button>
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
