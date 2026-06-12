import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Returns the local calendar date as a YYYY-MM-DD string.
 * Use this for any "today/tomorrow" or default date input value,
 * and for comparisons against DB date columns (which store local dates).
 *
 * Avoid `new Date().toISOString().slice(0,10)` — that returns the UTC date
 * and shifts by a day in non-UTC timezones (e.g. IST mornings show yesterday).
 */
export function toLocalYMD(date: Date | number = new Date()): string {
  const d = typeof date === "number" ? new Date(date) : date;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Local YMD for "today + n days" (n can be negative). */
export function localYMDOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return toLocalYMD(d);
}

/**
 * Smart human-friendly label for an expected_arrival_at timestamp.
 * Returns null if no/invalid input.
 *
 *  future tomorrow         → "Arr: Tomorrow 5:30 PM"
 *  future other day        → "Arr: 14 Jun 5:30 PM"
 *  today >2h away          → "Arr: Today 5:30 PM"
 *  today 1..120 min away   → "Arr: In 45 Min" / "Arr: In 2 Hours"
 *  ±5 min from arrival     → "Arr: Now"
 *  passed same day         → "Expected 5:30 PM"
 *  passed yesterday        → "Expected Yest' 5:30 PM"
 *  passed older            → "Expected 12 Jun 5:30 PM"
 */
export function smartArrival(iso: string | null | undefined): { label: string; tone: "muted" | "gold" | "warning" } | null {
  if (!iso) return null;
  const t = new Date(iso);
  if (isNaN(t.getTime())) return null;
  const now = new Date();
  const time = t.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
  const tYmd = toLocalYMD(t);
  const nYmd = toLocalYMD(now);
  const diffMin = Math.round((t.getTime() - now.getTime()) / 60000);

  if (Math.abs(diffMin) <= 5) return { label: "Arr: Now", tone: "gold" };

  if (diffMin > 0) {
    if (tYmd === nYmd) {
      if (diffMin < 60) return { label: `Arr: In ${diffMin} Min`, tone: "gold" };
      if (diffMin <= 120) {
        const hrs = Math.round(diffMin / 60);
        return { label: `Arr: In ${hrs} Hour${hrs === 1 ? "" : "s"}`, tone: "gold" };
      }
      return { label: `Arr: Today ${time}`, tone: "gold" };
    }
    if (tYmd === localYMDOffset(1)) return { label: `Arr: Tomorrow ${time}`, tone: "gold" };
    const date = t.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
    return { label: `Arr: ${date} ${time}`, tone: "muted" };
  }

  if (tYmd === nYmd) return { label: `Expected ${time}`, tone: "warning" };
  if (tYmd === localYMDOffset(-1)) return { label: `Expected Yest' ${time}`, tone: "warning" };
  const date = t.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
  return { label: `Expected ${date} ${time}`, tone: "warning" };
}
