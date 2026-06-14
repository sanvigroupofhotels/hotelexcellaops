/**
 * Phone normalization & validation utilities.
 *
 * Internal storage format (India default): +91XXXXXXXXXX
 *
 * Accepts:
 *   9876543210
 *   09876543210
 *   +919876543210
 *   +91 98765 43210
 *   98765 43210
 *   0 98765 43210
 *
 * Future SaaS: extend `normalizePhoneNumber` to accept a country code arg.
 */

const E164_IN = /^\+91\d{10}$/;

export function normalizePhoneNumber(input: string | null | undefined): string {
  if (!input) return "";
  // Strip all whitespace, dashes, brackets, dots
  let s = String(input).replace(/[\s\-()\.]/g, "");
  if (!s) return "";

  // Already +91XXXXXXXXXX
  if (/^\+91\d{10}$/.test(s)) return s;

  // +91 followed by extras — keep only digits after +91
  if (s.startsWith("+91")) {
    const digits = s.slice(3).replace(/\D/g, "");
    if (digits.length === 10) return `+91${digits}`;
    return s; // invalid; let validator catch
  }

  // 0091XXXXXXXXXX → +91XXXXXXXXXX
  if (s.startsWith("0091")) {
    const digits = s.slice(4).replace(/\D/g, "");
    if (digits.length === 10) return `+91${digits}`;
  }

  // 91XXXXXXXXXX (12 digits, no plus)
  if (/^91\d{10}$/.test(s)) return `+${s}`;

  // Leading 0 + 10 digits
  if (/^0\d{10}$/.test(s)) return `+91${s.slice(1)}`;

  // Plain 10 digits
  if (/^\d{10}$/.test(s)) return `+91${s}`;

  return s; // return cleaned but invalid — validator will flag
}

export function validatePhoneNumber(input: string | null | undefined): boolean {
  if (!input) return false;
  return E164_IN.test(normalizePhoneNumber(input));
}

/** Returns normalized or throws with friendly message. */
export function normalizeOrThrow(input: string | null | undefined): string {
  const n = normalizePhoneNumber(input);
  if (!E164_IN.test(n)) throw new Error("Please enter a valid mobile number.");
  return n;
}

/** Digits only, for wa.me links. */
export function phoneToWaDigits(input: string | null | undefined): string {
  const n = normalizePhoneNumber(input);
  return E164_IN.test(n) ? n.slice(1) : (input ?? "").replace(/\D/g, "");
}
