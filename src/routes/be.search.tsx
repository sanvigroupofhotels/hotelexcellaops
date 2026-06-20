/**
 * Booking Engine — search results.
 * Shows per-room-type availability and pricing for the chosen window.
 */
import { createFileRoute, useNavigate, useSearch, Link } from "@tanstack/react-router";
import { z } from "zod";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getAvailability } from "@/lib/booking-engine.functions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { BedDouble, CalendarDays, ArrowLeft, Users } from "lucide-react";

const SearchSchema = z.object({
  check_in: z.string(),
  check_out: z.string(),
  guests: z.coerce.number().int().min(1).max(10).default(2),
});

export const Route = createFileRoute("/be/search")({
  component: SearchPage,
  validateSearch: (raw) => SearchSchema.parse(raw),
});

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const dateLabel = (iso: string) =>
  new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short" });

function SearchPage() {
  const search = useSearch({ from: "/be/search" });
  const navigate = useNavigate();
  const fn = useServerFn(getAvailability);
  const q = useQuery({
    queryKey: ["be", "avail", search],
    queryFn: () =>
      fn({ data: { check_in: search.check_in, check_out: search.check_out, guests: search.guests } }),
  });

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <Link to="/be" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
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

      <h1 className="mt-4 font-display text-2xl">Available rooms</h1>

      {q.isLoading ? (
        <div className="mt-5 space-y-3">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-36 w-full rounded-md" />)}
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
          {(q.data?.results ?? []).filter((r) => r.subtotal > 0).map((r) => (
            <Card key={r.type} className="p-4 flex flex-col">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-display text-lg text-gold flex items-center gap-2">
                    <BedDouble className="h-5 w-5" /> {r.type}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {r.available > 0 ? `${r.available} room${r.available > 1 ? "s" : ""} left` : "Sold out"}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-display">{inr(r.subtotal / r.nights)}</p>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide">per night</p>
                </div>
              </div>

              <div className="mt-3 text-sm border-t border-border pt-3 space-y-1">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{r.nights} night{r.nights > 1 ? "s" : ""}</span>
                  <span>{inr(r.subtotal)}</span>
                </div>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Taxes ({Math.round(r.tax_rate * 100)}%)</span>
                  <span>{inr(r.taxes)}</span>
                </div>
                <div className="flex justify-between font-medium pt-1 border-t border-border mt-1">
                  <span>Total</span>
                  <span>{inr(r.total)}</span>
                </div>
              </div>

              <Button
                className="mt-4 gold-gradient text-charcoal hover:opacity-90"
                disabled={r.available <= 0}
                onClick={() =>
                  navigate({
                    to: "/be/checkout",
                    search: {
                      check_in: search.check_in,
                      check_out: search.check_out,
                      guests: search.guests,
                      room_type: r.type,
                    } as any,
                  })
                }
              >
                {r.available <= 0 ? "Sold out" : "Reserve"}
              </Button>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
