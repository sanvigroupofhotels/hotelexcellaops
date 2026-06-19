import { earlyCheckInLabel, lateCheckOutLabel } from "@/lib/mock-data";
import { useOpsTimeLabels } from "@/lib/check-times";


/**
 * Shared renderer for stay line-items, used by Quote Detail/Preview AND
 * Booking Detail/Preview to keep multi-item rendering consistent.
 */
export function StayItemsList({
  items,
  showSubtotals = true,
  title = "Stay Items",
}: {
  items: any[];
  showSubtotals?: boolean;
  title?: string;
}) {
  if (!items?.length) return null;
  const t = useOpsTimeLabels();
  const fmtDate = (s: string) =>
    new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

  return (
    <div className="space-y-5">
      <h4 className="text-[10px] uppercase tracking-[0.25em] text-gold">
        {title} ({items.length})
      </h4>
      {items.map((it: any, i: number) => (
        <div key={it.id ?? i} className="rounded-lg border border-border bg-secondary/20 p-4">
          <div className="flex items-baseline justify-between mb-2">
            <div className="font-display text-lg">Room {i + 1}</div>
            {showSubtotals && (
              <div className="font-display text-xl gold-text-gradient tabular-nums">
                ₹{Number(it.subtotal).toLocaleString("en-IN")}
              </div>
            )}
          </div>
          <ul className="text-sm space-y-1">
            <li>• <span className="text-muted-foreground">Room Type:</span> {it.room_type}
              {it.rooms > 1 ? ` × ${it.rooms}` : ""}</li>
            <li>• <span className="text-muted-foreground">Guests:</span> {it.adults} Adult{it.adults === 1 ? "" : "s"}
              {it.children > 0 ? ` + ${it.children} Child${it.children === 1 ? "" : "ren"}` : ""}
              {it.extra_bed ? ` + ${it.extra_bed} Extra Bed` : ""}</li>
            <li>• <span className="text-muted-foreground">Check-In:</span> {fmtDate(it.check_in)}, {t.checkIn}</li>
            <li>• <span className="text-muted-foreground">Check-Out:</span> {fmtDate(it.check_out)}, {t.checkOut}</li>
            <li>• <span className="text-muted-foreground">Nights:</span> {it.nights}</li>
            {it.breakfast_included && <li>• <span className="text-muted-foreground">Breakfast:</span> Included</li>}
            {(it.extra_adults ?? 0) > 0 && <li>• <span className="text-muted-foreground">Extra Adults:</span> {it.extra_adults}</li>}
            {(it.drivers ?? 0) > 0 && <li>• <span className="text-muted-foreground">Drivers:</span> {it.drivers}</li>}
            {it.early_check_in && it.early_check_in_slot &&
              <li>• <span className="text-muted-foreground">Early Check-in:</span> {earlyCheckInLabel(it.early_check_in_slot)}</li>}
            {it.late_check_out && it.late_check_out_slot &&
              <li>• <span className="text-muted-foreground">Late Check-out:</span> {lateCheckOutLabel(it.late_check_out_slot)}</li>}
            {it.pet_size && it.pet_size !== "none" &&
              <li>• <span className="text-muted-foreground">Pet:</span> {it.pet_size}</li>}
          </ul>
        </div>
      ))}
    </div>
  );
}
