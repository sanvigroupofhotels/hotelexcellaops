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
