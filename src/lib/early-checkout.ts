function todayKolkataYMD(): string {
  const parts = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Nights remaining before the scheduled departure (0 when on/after it). Uses the later of business date and live India date. */
export function nightsRemaining(checkOut: string | null | undefined, businessDate: string | null | undefined, calendarDate?: string | null): number {
  if (!checkOut) return 0;
  const cal = calendarDate ?? todayKolkataYMD();
  const eff = businessDate && businessDate > cal ? businessDate : cal;
  if (eff >= checkOut) return 0;
  const ms = new Date(checkOut + "T00:00:00Z").getTime() - new Date(eff + "T00:00:00Z").getTime();
  return Math.max(0, Math.round(ms / 86400000));
}

/** Returns true when checkout may proceed (on-time, or staff confirmed early departure). */
export function confirmEarlyCheckout(label: string, checkOut: string | null | undefined, businessDate: string | null | undefined): boolean {
  const n = nightsRemaining(checkOut, businessDate);
  if (n === 0) return true;
  const d = new Date(checkOut + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
  return window.confirm(
    `Early Check-Out Warning\n\n${label} is scheduled to stay until ${d} (${n} night${n > 1 ? "s" : ""} remaining).\n\nChecking out early will immediately release the room for other bookings. Confirm early check-out?`,
  );
}
