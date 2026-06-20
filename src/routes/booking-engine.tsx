/**
 * Booking Engine layout — host-routed for book.hotelexcella.in.
 * Provides the branded header / footer for every /be/* page.
 */
import { createFileRoute, Outlet, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getEngineConfig } from "@/lib/booking-engine.functions";
import { Phone, Mail, MapPin } from "lucide-react";

export const Route = createFileRoute("/booking-engine")({
  component: BookingEngineLayout,
  head: () => ({
    meta: [
      { title: "Book Your Stay · Hotel Excella" },
      { name: "description", content: "Reserve your room at Hotel Excella — secure online booking with instant confirmation." },
      { property: "og:title", content: "Hotel Excella · Direct Bookings" },
      { property: "og:description", content: "Best rates guaranteed. Reserve direct and skip the middleman." },
      { property: "og:type", content: "website" },
    ],
  }),
});

export function useEngineConfig() {
  const fn = useServerFn(getEngineConfig);
  return useQuery({
    queryKey: ["be", "config"],
    queryFn: () => fn({}),
    staleTime: 5 * 60_000,
  });
}

function BookingEngineLayout() {
  const { data: cfg } = useEngineConfig();
  const hotelName = cfg?.hotel.name ?? "Hotel Excella";
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto max-w-5xl px-4 py-3 flex items-center justify-between">
          <Link to="/booking-engine" className="flex items-center gap-2">
            {cfg?.hotel.logo_url ? (
              <img src={cfg.hotel.logo_url} alt={hotelName} className="h-9 w-auto" />
            ) : (
              <span className="font-display text-xl text-gold tracking-wide">{hotelName}</span>
            )}
          </Link>
          <a href={cfg?.hotel.phone ? `tel:${cfg.hotel.phone}` : "#"} className="text-sm text-muted-foreground hover:text-gold flex items-center gap-1">
            <Phone className="h-4 w-4" />
            <span className="hidden sm:inline">{cfg?.hotel.phone || "Contact"}</span>
          </a>
        </div>
      </header>

      <main className="flex-1">
        <Outlet />
      </main>

      <footer className="border-t border-border mt-12 bg-card/40">
        <div className="mx-auto max-w-5xl px-4 py-6 text-sm text-muted-foreground space-y-2">
          <p className="font-display text-lg text-foreground">{hotelName}</p>
          {cfg?.hotel.address ? (
            <p className="flex items-center gap-2"><MapPin className="h-4 w-4" /> {cfg.hotel.address}</p>
          ) : null}
          {cfg?.hotel.phone ? (
            <p className="flex items-center gap-2"><Phone className="h-4 w-4" /> {cfg.hotel.phone}</p>
          ) : null}
          {cfg?.hotel.email ? (
            <p className="flex items-center gap-2"><Mail className="h-4 w-4" /> {cfg.hotel.email}</p>
          ) : null}
          <p className="pt-4 text-xs">© {new Date().getFullYear()} {hotelName}. Direct bookings · best rates guaranteed.</p>
        </div>
      </footer>
    </div>
  );
}
