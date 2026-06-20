/**
 * Booking Engine — confirmation page.
 * Shows booking summary + portal link + WhatsApp share.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getConfirmation } from "@/lib/booking-engine.functions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CheckCircle2, Calendar, BedDouble, Users, Phone, ExternalLink, Loader2 } from "lucide-react";

export const Route = createFileRoute("/booking-engine/confirmation/$ref")({
  component: ConfirmationPage,
});

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const dateLabel = (iso: string) =>
  new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short", year: "numeric" });

function ConfirmationPage() {
  const { ref } = Route.useParams();
  const fn = useServerFn(getConfirmation);
  const q = useQuery({
    queryKey: ["be", "confirm", ref],
    queryFn: () => fn({ data: { reference: ref } }),
    refetchInterval: (query) => ((query.state.data as any)?.advancePaid ? false : 4000),
  });

  if (q.isLoading) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <Loader2 className="h-6 w-6 animate-spin mx-auto text-gold" />
      </div>
    );
  }
  if (q.isError || !q.data) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-12">
        <Card className="p-6 text-center">
          <p className="font-display text-lg">We couldn't find this booking</p>
          <p className="text-sm text-muted-foreground mt-2">Please check the link or contact the hotel.</p>
          <Link to="/booking-engine" className="inline-block mt-4 text-sm text-gold underline">Back to home</Link>
        </Card>
      </div>
    );
  }

  const b = q.data;
  const portalUrl = b.token ? `https://guest.hotelexcella.in/${b.token}` : "";
  const waText = encodeURIComponent(
    `Hello ${b.guestName},\n\nYour booking at Hotel Excella is confirmed.\n\nRef: ${b.reference}\nCheck-In: ${b.checkIn}\nCheck-Out: ${b.checkOut}\nRoom: ${b.roomType}\nGuests: ${b.guests}\nTotal: ${inr(b.amount)}${b.payAtHotel ? "\nPayment: Pay at Hotel" : `\nPaid: ${inr(b.advancePaid)}`}\n\nView booking: ${portalUrl}`,
  );

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <div className="text-center">
        <CheckCircle2 className="h-16 w-16 text-emerald-500 mx-auto" />
        <h1 className="font-display text-3xl mt-3">Booking Confirmed</h1>
        <p className="text-sm text-muted-foreground mt-2">
          Reference <span className="font-mono font-medium text-foreground">{b.reference}</span>
        </p>
      </div>

      <Card className="mt-6 p-5 space-y-3">
        <Row label="Guest" value={b.guestName} />
        <Row label="Mobile" value={b.phone || "—"} />
        {b.email ? <Row label="Email" value={b.email} /> : null}
        <Row label="Check-In" value={dateLabel(b.checkIn)} icon={<Calendar className="h-4 w-4" />} />
        <Row label="Check-Out" value={dateLabel(b.checkOut)} icon={<Calendar className="h-4 w-4" />} />
        <Row label="Room" value={b.roomType ?? "—"} icon={<BedDouble className="h-4 w-4" />} />
        <Row label="Guests" value={String(b.guests)} icon={<Users className="h-4 w-4" />} />
        <div className="border-t border-border pt-3 space-y-1">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Total amount</span>
            <span className="font-medium">{inr(b.amount)}</span>
          </div>
          {b.payAtHotel ? (
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Payment</span>
              <span className="font-medium">Pay at hotel</span>
            </div>
          ) : (
            <>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Paid</span>
                <span className="font-medium text-emerald-500">{inr(b.advancePaid)}</span>
              </div>
              {b.amount - b.advancePaid > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Balance due at check-in</span>
                  <span className="font-medium">{inr(b.amount - b.advancePaid)}</span>
                </div>
              )}
            </>
          )}
        </div>
      </Card>

      <div className="mt-6 grid gap-2 sm:grid-cols-2">
        {portalUrl && (
          <Button asChild className="gold-gradient text-charcoal hover:opacity-90 h-11">
            <a href={portalUrl}>
              Open Guest Portal <ExternalLink className="ml-2 h-4 w-4" />
            </a>
          </Button>
        )}
        <Button variant="outline" asChild className="h-11 border-gold/40">
          <a href={`https://wa.me/?text=${waText}`} target="_blank" rel="noreferrer">
            Share via WhatsApp
          </a>
        </Button>
      </div>

      <p className="mt-6 text-center text-xs text-muted-foreground">
        A confirmation has been sent to your phone and email. Need help? Contact the hotel reception.
      </p>
    </div>
  );
}

function Row({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 text-sm">
      <span className="text-muted-foreground inline-flex items-center gap-1.5">{icon}{label}</span>
      <span className="font-medium text-right">{value}</span>
    </div>
  );
}
