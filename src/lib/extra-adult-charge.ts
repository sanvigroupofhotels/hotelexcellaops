/** In-House Extra Adult charge helpers: quantity = adults × nights, unit = rate/night. */
const TAG = /\[extra_adult:\s*(\d+)\s*x\s*(\d+)\]/i;

export function parseExtraAdultTag(notes?: string | null): { adults: number; nights: number } | null {
  const m = notes?.match(TAG);
  return m ? { adults: Number(m[1]), nights: Number(m[2]) } : null;
}

export function withExtraAdultTag(notes: string | null | undefined, adults: number, nights: number): string {
  const clean = (notes ?? "").replace(TAG, "").trim();
  return `${clean ? clean + " " : ""}[extra_adult: ${adults} x ${nights}]`;
}

export function stayNights(checkIn?: string | null, checkOut?: string | null): number {
  if (!checkIn || !checkOut) return 1;
  const d = (Date.parse(checkOut) - Date.parse(checkIn)) / 86400000;
  return Number.isFinite(d) && d > 0 ? Math.round(d) : 1;
}

export function extraAdultAmount(adults: number, nights: number, rate: number): number {
  return Math.max(0, adults) * Math.max(0, nights) * Math.max(0, rate);
}
