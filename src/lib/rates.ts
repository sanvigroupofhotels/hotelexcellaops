/**
 * Rate resolver. Priority:
 *   1. Date override
 *   2. Weekend / Weekday rate
 *   3. Default rate
 *
 * Returns null if no configuration exists (caller may fall back to legacy getRoomRate).
 */
import type { RoomRateRow, RateOverrideRow } from "./rates-api";

/**
 * Hotel-business weekend = Friday & Saturday (the high-tariff nights).
 * (Sunday-Thursday are weekdays.)
 */
export function isWeekend(dateISO: string): boolean {
  const d = new Date(dateISO + "T00:00:00");
  const day = d.getDay(); // Sun=0 ... Fri=5, Sat=6
  return day === 5 || day === 6;
}

export function resolveRate(
  room_type: string,
  dateISO: string,
  rates: RoomRateRow[],
  overrides: RateOverrideRow[],
): number | null {
  const ovr = overrides.find((o) => o.room_type === room_type && o.date === dateISO);
  if (ovr) return Number(ovr.rate);
  const cfg = rates.find((r) => r.room_type === room_type);
  if (!cfg) return null;
  if (isWeekend(dateISO)) {
    if (cfg.weekend_rate != null) return Number(cfg.weekend_rate);
  } else {
    if (cfg.weekday_rate != null) return Number(cfg.weekday_rate);
  }
  return Number(cfg.default_rate ?? 0) || null;
}

/** Average rate across a check_in → check_out window (per-night basis). */
export function resolveAverageRate(
  room_type: string,
  check_in: string,
  check_out: string,
  rates: RoomRateRow[],
  overrides: RateOverrideRow[],
): number | null {
  const start = new Date(check_in + "T00:00:00");
  const end = new Date(check_out + "T00:00:00");
  let nights = 0;
  let sum = 0;
  let anyFound = false;
  for (let d = new Date(start); d < end; d.setDate(d.getDate() + 1)) {
    const key = toLocalYMD(d);
    const r = resolveRate(room_type, key, rates, overrides);
    if (r != null) { sum += r; anyFound = true; }
    nights++;
  }
  if (!anyFound || nights === 0) return null;
  return Math.round(sum / nights);
}
