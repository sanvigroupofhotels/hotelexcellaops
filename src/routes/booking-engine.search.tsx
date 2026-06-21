/**
 * Booking Engine — Step 2 (Choose Room).
 * Shows per-room-type cards with MRP, fixed feature list, and per-night
 * inventory price. "Continue" navigates to Step 3 (Guest Details).
 */
import { createFileRoute, useNavigate, useSearch, Link } from "@tanstack/react-router";
import { z } from "zod";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getAvailability } from "@/lib/booking-engine.functions";
import { getRoomMeta } from "@/lib/booking-engine-rooms";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { BedDouble, CalendarDays, ArrowLeft, Users, Check } from "lucide-react";

const SearchSchema = z.object({
  check_in: z.string(),
  check_out: z.string(),
  guests: z.coerce.number().int().min(1).max(10).default(2),
});

export const Route = createFileRoute("/booking-engine/search")({
  component: SearchPage,
  validateSearch: (raw) => SearchSchema.parse(raw),
});

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const dateLabel = (iso: string) =>
  new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short" });

function SearchPage() {
  const search = useSearch({ from: "/booking-engine/search" });
  const navigate = useNavigate();
  const fn = useServerFn(getAvailability);
  const q = useQuery({
    queryKey: ["be", "avail", search],
    queryFn: () =>
      fn({ data: { check_in: search.check_in, check_out: search.check_out, guests: search.guests } }),
  });

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <Link to="/booking-engine" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Change dates
      </Link>

      <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
        <span className="inline-flex items-center gap-1.5">
          <CalendarDays className="h-4 w-4 text-gold" />
          {dateLabel(search.check_in)} → {dateLabel(search.check_out)}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Users className="h-4 w-4 text-gold" />
          {search.guests} guest{search.guests > 1 ? "s" : ""}
        </span>
        <span className="text-muted-foreground">· {q.data?.nights ?? "—"} night{(q.data?.nights ?? 0) > 1 ? "s" : ""}</span>
      </div>

      <h1 className="mt-4 font-display text-2xl">Choose your room</h1>

      {q.isLoading ? (
        <div className="mt-5 space-y-3">
          {[0, 1].map((i) => <Skeleton key={i} className="h-72 w-full rounded-md" />)}
        </div>
      ) : q.isError ? (
        <Card className="mt-5 p-6 text-sm text-destructive">
          {(q.error as Error)?.message || "Something went wrong loading availability."}
        </Card>
      ) : (q.data?.results ?? []).filter((r) => r.subtotal > 0).length === 0 ? (
        <Card className="mt-5 p-6 text-center">
          <p className="font-display text-lg">No rooms available for these dates</p>
          <p className="text-sm text-muted-foreground mt-2">Try a different date range or contact the hotel.</p>
        </Card>
      ) : (
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          {(q.data?.results ?? []).filter((r) => r.subtotal > 0).map((r) => {
            const meta = getRoomMeta(r.type);
            const perNight = Math.round(r.total / r.nights);
            const soldOut = r.available <= 0;
            return (
              <Card key={r.type} className="p-5 flex flex-col">
                <div className="flex items-center gap-2">
                  <BedDouble className="h-5 w-5 text-gold" />
                  <p className="font-display text-xl text-gold">{r.type}</p>
                </div>
                <p className="text-sm text-muted-foreground mt-1">{meta.tagline}</p>

                <ul className="mt-4 space-y-1.5 text-sm">
                  {meta.features.map((f) => (
                    <li key={f} className="flex items-center gap-2">
                      <Check className="h-4 w-4 text-gold shrink-0" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>

                <div className="mt-5 border-t border-border pt-4 flex items-end justify-between gap-3">
                  <div>
                    {meta.mrp > 0 && (
                      <p className="text-sm text-muted-foreground line-through">{inr(meta.mrp)}</p>
                    )}
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground mt-0.5">From</p>
                    <p className="font-display text-2xl text-foreground leading-tight">{inr(perNight)}</p>
                    <p className="text-[11px] text-muted-foreground">Per night (Pay Now)</p>
                  </div>
                  <Button
                    className="gold-gradient text-charcoal hover:opacity-90 px-5 h-10"
                    disabled={soldOut}
                    onClick={() =>
                      navigate({
                        to: "/booking-engine/checkout",
                        search: {
                          check_in: search.check_in,
                          check_out: search.check_out,
                          guests: search.guests,
                          room_type: r.type,
                        } as any,
                      })
                    }
                  >
                    {soldOut ? "Sold out" : "Continue →"}
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
