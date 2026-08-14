/**
 * Shared phone-number service — ONE implementation for all of HEOS.
 *
 * Backed by `libphonenumber-js` (Google libphonenumber metadata), so country
 * rules are maintained by the library, never by hand-rolled regexes.
 *
 * Canonical stored format: E.164, e.g. `+919876543210`, `+33745630049`.
 * Default country: India (IN) — a bare `9876543210` still normalises to
 * `+919876543210`, so every existing Indian workflow behaves exactly as before.
 *
 * UI code should use `<PhoneField />` (src/components/phone-field.tsx) which is
 * built on top of these helpers.
 */
import {
  parsePhoneNumberFromString,
  isValidPhoneNumber,
  getCountryCallingCode,
  type CountryCode,
} from "libphonenumber-js";

export const DEFAULT_COUNTRY: CountryCode = "IN";
export type { CountryCode };

/** Countries surfaced first in the picker (hotel's common source markets). */
export const PHONE_COUNTRIES: { code: CountryCode; name: string; flag: string }[] = [
  { code: "IN", name: "India", flag: "🇮🇳" },
  { code: "AE", name: "UAE", flag: "🇦🇪" },
  { code: "GB", name: "United Kingdom", flag: "🇬🇧" },
  { code: "US", name: "United States", flag: "🇺🇸" },
  { code: "CA", name: "Canada", flag: "🇨🇦" },
  { code: "FR", name: "France", flag: "🇫🇷" },
  { code: "DE", name: "Germany", flag: "🇩🇪" },
  { code: "IT", name: "Italy", flag: "🇮🇹" },
  { code: "ES", name: "Spain", flag: "🇪🇸" },
  { code: "NL", name: "Netherlands", flag: "🇳🇱" },
  { code: "CH", name: "Switzerland", flag: "🇨🇭" },
  { code: "SE", name: "Sweden", flag: "🇸🇪" },
  { code: "RU", name: "Russia", flag: "🇷🇺" },
  { code: "SA", name: "Saudi Arabia", flag: "🇸🇦" },
  { code: "QA", name: "Qatar", flag: "🇶🇦" },
  { code: "OM", name: "Oman", flag: "🇴🇲" },
  { code: "KW", name: "Kuwait", flag: "🇰🇼" },
  { code: "SG", name: "Singapore", flag: "🇸🇬" },
  { code: "MY", name: "Malaysia", flag: "🇲🇾" },
  { code: "TH", name: "Thailand", flag: "🇹🇭" },
  { code: "ID", name: "Indonesia", flag: "🇮🇩" },
  { code: "LK", name: "Sri Lanka", flag: "🇱🇰" },
  { code: "NP", name: "Nepal", flag: "🇳🇵" },
  { code: "BD", name: "Bangladesh", flag: "🇧🇩" },
  { code: "JP", name: "Japan", flag: "🇯🇵" },
  { code: "KR", name: "South Korea", flag: "🇰🇷" },
  { code: "CN", name: "China", flag: "🇨🇳" },
  { code: "HK", name: "Hong Kong", flag: "🇭🇰" },
  { code: "AU", name: "Australia", flag: "🇦🇺" },
  { code: "NZ", name: "New Zealand", flag: "🇳🇿" },
  { code: "ZA", name: "South Africa", flag: "🇿🇦" },
  { code: "BR", name: "Brazil", flag: "🇧🇷" },
  { code: "MX", name: "Mexico", flag: "🇲🇽" },
  { code: "TR", name: "Turkey", flag: "🇹🇷" },
  { code: "IL", name: "Israel", flag: "🇮🇱" },
  { code: "IE", name: "Ireland", flag: "🇮🇪" },
  { code: "PT", name: "Portugal", flag: "🇵🇹" },
  { code: "BE", name: "Belgium", flag: "🇧🇪" },
  { code: "AT", name: "Austria", flag: "🇦🇹" },
  { code: "PL", name: "Poland", flag: "🇵🇱" },
  { code: "NO", name: "Norway", flag: "🇳🇴" },
  { code: "DK", name: "Denmark", flag: "🇩🇰" },
  { code: "FI", name: "Finland", flag: "🇫🇮" },
  { code: "PH", name: "Philippines", flag: "🇵🇭" },
  { code: "VN", name: "Vietnam", flag: "🇻🇳" },
  { code: "MV", name: "Maldives", flag: "🇲🇻" },
];

export function callingCodeFor(country: CountryCode): string {
  try {
    return getCountryCallingCode(country);
  } catch {
    return "";
  }
}

function clean(input: string | null | undefined): string {
  if (!input) return "";
  return String(input).replace(/[\s\-()\.]/g, "");
}

/**
 * Normalise any user input to E.164. Numbers already carrying a `+` country
 * code are honoured; bare national numbers are interpreted in `country`
 * (India by default, preserving legacy behaviour).
 *
 * Returns the cleaned input unchanged when it cannot be parsed, so callers can
 * flag it via `validatePhoneNumber`.
 */
export function normalizePhoneNumber(
  input: string | null | undefined,
  country: CountryCode = DEFAULT_COUNTRY,
): string {
  const s = clean(input);
  if (!s) return "";

  // International input (+.. or 00..)
  const intl = s.startsWith("00") ? `+${s.slice(2)}` : s;
  if (intl.startsWith("+")) {
    const parsed = parsePhoneNumberFromString(intl);
    if (parsed?.isValid()) return parsed.number;
    return intl;
  }

  const parsed = parsePhoneNumberFromString(s, country);
  if (parsed?.isValid()) return parsed.number;

  // Legacy tolerance: bare 91XXXXXXXXXX pasted without a plus.
  if (country === "IN" && /^91\d{10}$/.test(s)) {
    const p2 = parsePhoneNumberFromString(`+${s}`);
    if (p2?.isValid()) return p2.number;
  }
  return s;
}

/** True when the number is structurally valid for its (or the given) country. */
export function validatePhoneNumber(
  input: string | null | undefined,
  country: CountryCode = DEFAULT_COUNTRY,
): boolean {
  const n = normalizePhoneNumber(input, country);
  if (!n) return false;
  if (n.startsWith("+")) return isValidPhoneNumber(n);
  return isValidPhoneNumber(n, country);
}

/** Returns E.164 or throws with a friendly, country-aware message. */
export function normalizeOrThrow(
  input: string | null | undefined,
  country: CountryCode = DEFAULT_COUNTRY,
): string {
  const n = normalizePhoneNumber(input, country);
  if (!validatePhoneNumber(n, country)) throw new Error("Please enter a valid phone number.");
  return n;
}

/** Digits only (no `+`), for wa.me / tel deep links. Keeps the real country code. */
export function phoneToWaDigits(input: string | null | undefined): string {
  const n = normalizePhoneNumber(input);
  if (validatePhoneNumber(n)) return n.replace(/\D/g, "");
  return (input ?? "").replace(/\D/g, "");
}

/** Friendly display form, e.g. "+33 7 45 63 00 49" / "+91 98765 43210". */
export function formatPhoneDisplay(input: string | null | undefined): string {
  const n = normalizePhoneNumber(input);
  const parsed = n ? parsePhoneNumberFromString(n.startsWith("+") ? n : `+${n}`) : undefined;
  return parsed?.isValid() ? parsed.formatInternational() : (input ?? "");
}

/** Split a stored E.164 value into { country, national } for the input UI. */
export function splitPhone(
  input: string | null | undefined,
  fallback: CountryCode = DEFAULT_COUNTRY,
): { country: CountryCode; national: string } {
  const s = clean(input);
  if (!s) return { country: fallback, national: "" };
  const parsed = parsePhoneNumberFromString(s.startsWith("+") ? s : `+${s}`);
  if (parsed?.country) return { country: parsed.country, national: parsed.nationalNumber };
  const inIn = parsePhoneNumberFromString(s, fallback);
  if (inIn?.isValid()) return { country: fallback, national: inIn.nationalNumber };
  return { country: fallback, national: s.replace(/^\+/, "") };
}

/**
 * Search variants for digits-insensitive phone matching. Returns the E.164
 * value, the digits-only form and the national (country-code-stripped) form so
 * `ilike %…%` queries match however the number was typed or stored.
 */
export function phoneSearchVariants(input: string | null | undefined): string[] {
  const raw = clean(input);
  if (!raw) return [];
  const out = new Set<string>();
  out.add(raw);
  out.add(raw.replace(/\D/g, ""));
  const n = normalizePhoneNumber(raw);
  if (n) {
    out.add(n);
    out.add(n.replace(/\D/g, ""));
    const { national } = splitPhone(n);
    if (national) out.add(national);
  }
  return [...out].filter((v) => v.length >= 3);
}
