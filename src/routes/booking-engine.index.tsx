/**
 * Booking Engine — landing / search entry point.
 * Mobile-first: hero, date pickers, guests, "Check Availability" CTA.
 */
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useEngineConfig } from "./booking-engine";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { CalendarDays, Users, Sparkles, Shield, Tag } from "lucide-react";

export const Route = createFileRoute("/booking-engine/")({
  component: LandingPage,
});

function todayPlus(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function LandingPage() {
  const { data: cfg } = useEngineConfig();
  const navigate = useNavigate();
  const [checkIn, setCheckIn] = useState(todayPlus(1));
  const [checkOut, setCheckOut] = useState(todayPlus(2));
  const [guests, setGuests] = useState(2);

  const today = todayPlus(0);
  const minOut = (() => {
    const d = new Date(checkIn + "T00:00:00");
    d.setDate(d.getDate() + 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  })();

  function search() {
    navigate({ to: "/booking-engine/search", search: { check_in: checkIn, check_out: checkOut, guests } as any });
  }

  const hero = cfg?.branding.hero_image_url || "";

  return (
    <div>
      {/* Hero */}
      <section className="relative">
        <div
          className="h-[40vh] sm:h-[50vh] bg-cover bg-center"
          style={{
            backgroundImage: hero
              ? `linear-gradient(180deg, rgba(0,0,0,0.2), rgba(0,0,0,0.7)), url(${hero})`
              : "linear-gradient(135deg, hsl(var(--charcoal)) 0%, hsl(var(--background)) 100%)",
          }}
        >
          <div className="mx-auto max-w-5xl px-4 h-full flex flex-col justify-end pb-8">
            <h1 className="font-display text-3xl sm:text-5xl text-gold leading-tight">
              {cfg?.branding.welcome_message || "Your stay, perfectly arranged."}
            </h1>
            <p className="mt-2 text-sm sm:text-base text-white/80 max-w-2xl">
              Book direct for the best available rate · instant confirmation · no booking fees.
            </p>
          </div>
        </div>
      </section>

      {/* Search card */}
      <section className="mx-auto max-w-5xl px-4 -mt-10 relative z-10">
        <Card className="p-4 sm:p-6 shadow-2xl border-gold/20">
          <div className="grid gap-3 sm:grid-cols-4">
            <div>
              <Label className="text-xs">Check-In</Label>
              <div className="relative">
                <CalendarDays className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                <Input
                  type="date"
                  value={checkIn}
                  min={today}
                  onChange={(e) => {
                    const v = e.target.value;
                    setCheckIn(v);
                    if (v >= checkOut) {
                      const d = new Date(v + "T00:00:00");
                      d.setDate(d.getDate() + 1);
                      setCheckOut(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
                    }
                  }}
                  className="pl-8"
                />
              </div>
            </div>
            <div>
              <Label className="text-xs">Check-Out</Label>
              <div className="relative">
                <CalendarDays className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                <Input
                  type="date"
                  value={checkOut}
                  min={minOut}
                  onChange={(e) => setCheckOut(e.target.value)}
                  className="pl-8"
                />
              </div>
            </div>
            <div>
              <Label className="text-xs">Guests</Label>
              <div className="relative">
                <Users className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                <Input
                  type="number"
                  min={1}
                  max={6}
                  value={guests}
                  onChange={(e) => setGuests(Math.max(1, Math.min(6, Number(e.target.value) || 1)))}
                  className="pl-8"
                />
              </div>
            </div>
            <div className="flex items-end">
              <Button onClick={search} className="w-full h-10 gold-gradient text-charcoal hover:opacity-90">
                Check Availability
              </Button>
            </div>
          </div>
        </Card>
      </section>

      {/* Trust strip */}
      <section className="mx-auto max-w-5xl px-4 mt-10 grid gap-4 sm:grid-cols-3">
        {[
          { icon: Tag, title: "Best rate guaranteed", body: "Direct bookings always come with our lowest available price." },
          { icon: Sparkles, title: "Instant confirmation", body: "WhatsApp + email confirmation the moment your booking is made." },
          { icon: Shield, title: "Secure payment", body: "Card, UPI and Netbanking via Razorpay — or pay at the hotel." },
        ].map((b) => (
          <div key={b.title} className="flex items-start gap-3 p-4 rounded-md border border-border bg-card/40">
            <b.icon className="h-5 w-5 text-gold mt-1" />
            <div>
              <p className="font-display text-base">{b.title}</p>
              <p className="text-xs text-muted-foreground mt-1">{b.body}</p>
            </div>
          </div>
        ))}
      </section>

      {/* Existing booking */}
      <section className="mx-auto max-w-5xl px-4 my-10 text-center text-sm text-muted-foreground">
        Have a booking?{" "}
        <a href="https://guest.hotelexcella.in" className="text-gold underline">
          Open the Guest Portal
        </a>
      </section>
    </div>
  );
}
