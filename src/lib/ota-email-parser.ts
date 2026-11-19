import { isOtaSystemEmail } from "@/lib/ota-domains";
import { normalizePhoneNumber, validatePhoneNumber } from "@/lib/phone";
import { OTA_ROOM_LABELS, OTA_PAYMENT_LABELS } from "@/lib/ota-import-rules";

type ParserOptions = { blockedEmails?: string[] };
export type ParsedBooking = {
  external_ref: string;
  guest_name: string;
  phone: string | null;
  email: string | null;
  check_in: string;
  check_out: string;
  guests: number;
  room_details: string;
  rooms: string | null;
  room_charges: number;
  subtotal: number;
  discount: number;
  taxable_amount: number;
  tax: number;
  total_amount: number;
  amount_paid: number;
  balance_due: number;
  payment_mode: string | null;
  booking_status: string;
  special_requests: string | null;
};

function pick(text: string, re: RegExp): string | null {
  const m = text.match(re);
  return m ? m[1].trim() : null;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function labelRegex(labels: string[]): RegExp | null {
  if (!labels.length) return null;
  const alt = labels.map((l) => escapeRe(l).replace(/\s+/g, "\\s*[-\\s]*")).join("|");
  // Strict match:
  //   - Label must not be followed by another alphanumeric char
  //     ("Discount" must NOT match "Discounted Total")
  //   - Separator [:|\-] is REQUIRED (prevents bare-label numeric grabs)
  //   - Optional parenthetical between label and separator (e.g. "Tax (5%):")
  return new RegExp(`(?:${alt})(?![A-Za-z0-9])(?:\\s*\\([^)]*\\))?\\s*[:|\\-]\\s*([^\\n|]+?)(?=\\n|\\||$)`, "i");
}

function pickByLabels(text: string, labels: string[]): string | null {
  const re = labelRegex(labels);
  return re ? pick(text, re) : null;
}

function pickAllByLabels(text: string, labels: string[]): string[] {
  if (!labels.length) return [];
  const alt = labels.map((l) => escapeRe(l).replace(/\s+/g, "\\s*[-\\s]*")).join("|");
  const re = new RegExp(`(?:${alt})(?![A-Za-z0-9])(?:\\s*\\([^)]*\\))?\\s*[:|\\-]\\s*([^\\n|]+?)(?=\\n|\\||$)`, "gi");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.push(m[1].trim());
  return out;
}

function pickAllLineByLabels(text: string, labels: string[]): string[] {
  if (!labels.length) return [];
  const alt = labels.map((l) => escapeRe(l).replace(/\s+/g, "\\s*[-\\s]*")).join("|");
  const re = new RegExp(`^\\s*(?:${alt})(?![A-Za-z0-9])(?:\\s*\\([^)]*\\))?\\s*[:|\\-]\\s*(.+?)\\s*$`, "i");
  return text
    .split("\n")
    .map((line) => line.match(re)?.[1]?.trim() ?? null)
    .filter((v): v is string => !!v);
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const key = v.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(v.trim());
  }
  return out;
}

function extractGuestDetailsSection(text: string): string | null {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => /^\s*guest\s+(details|information)\s*:?\s*$/i.test(line));
  if (start < 0) return null;
  const end = lines.findIndex((line, i) => (
    i > start &&
    /^\s*(booking|room|stay|payment|tariff|price|fare|property|hotel|cancellation|terms)\b.*:?\s*$/i.test(line) &&
    !/guest/i.test(line)
  ));
  return lines.slice(start + 1, end > start ? end : Math.min(lines.length, start + 24)).join("\n").trim() || null;
}

function pickFirstByLabelsFromTexts(texts: string[], labels: string[]): string | null {
  for (const text of texts) {
    const lineMatch = pickAllLineByLabels(text, labels)[0];
    if (lineMatch) return lineMatch;
    const fallback = pickByLabels(text, labels);
    if (fallback) return fallback;
  }
  return null;
}

function pickAllByLabelsFromTexts(texts: string[], labels: string[]): string[] {
  const values: string[] = [];
  for (const text of texts) {
    values.push(...pickAllLineByLabels(text, labels));
    values.push(...pickAllByLabels(text, labels));
  }
  return uniqueStrings(values);
}

const RECEPTION_NUMBERS = new Set(["9985908131", "09985908131", "+919985908131", "919985908131"]);

function last10Digits(input: string): string {
  return input.replace(/\D/g, "").slice(-10);
}

function isReceptionPhone(input: string): boolean {
  const digits = last10Digits(input);
  return [...RECEPTION_NUMBERS].some((n) => last10Digits(n) === digits);
}

function phoneMatches(input: string): string[] {
  return input.match(/\+\s*91[\s-]?\d{5}[\s-]?\d{5}|\+\s*91[\s-]?\d{10}|\b[6-9]\d{9}\b/g) ?? [];
}

function pickGuestPhone(labelCandidates: string[], scanTexts: string[]): string | null {
  const candidates = uniqueStrings([
    ...labelCandidates.flatMap(phoneMatches),
    ...scanTexts.flatMap(phoneMatches),
  ]);
  for (const candidate of candidates) {
    if (isReceptionPhone(candidate)) continue;
    const n = normalizePhoneNumber(candidate.replace(/[^+\d]/g, ""));
    if (validatePhoneNumber(n)) return n;
  }
  return null;
}

function emailMatches(input: string): string[] {
  return input.match(/[\w.+-]+@[\w.-]+\.\w+/g) ?? [];
}

function pickGuestEmail(labelCandidates: string[], scanTexts: string[], blockedEmails: string[] = []): string | null {
  const blocked = new Set(blockedEmails.map((e) => e.trim().toLowerCase()).filter(Boolean));
  const candidates = uniqueStrings([
    ...labelCandidates.flatMap(emailMatches),
    ...scanTexts.flatMap(emailMatches),
  ]).map((e) => e.toLowerCase());
  return candidates.find((e) => !blocked.has(e) && !isOtaSystemEmail(e)) ?? null;
}

const MONTH_MAP: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

function normalizeDate(input: string | null): string | null {
  if (!input) return null;
  const s = input.trim().replace(/,/g, "");
  let m = s.match(/(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = s.match(/(\d{1,2})[-\/](\d{1,2})[-\/](\d{2,4})/);
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  // FabHotels style: "15 JUN 26" or "15 Jun 2026"
  m = s.match(/(\d{1,2})\s+([A-Za-z]{3,4})\s+(\d{2,4})/);
  if (m) {
    const mon = MONTH_MAP[m[2].toLowerCase()];
    if (mon) {
      const y = m[3].length === 2 ? `20${m[3]}` : m[3];
      return `${y}-${String(mon).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    }
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function parseMoney(input: string | null): number {
  if (!input) return 0;
  const cleaned = input.replace(/[^0-9.]/g, "");
  return cleaned ? parseFloat(cleaned) : 0;
}

// ---------- Provider parsers ----------

export const HOTELZIFY_DEFAULTS: Record<string, string[]> = {
  booking_id: ["Booking ID", "Booking Id", "Booking Reference", "Booking Ref", "Booking No", "Booking Number", "Confirmation Number"],
  guest_name: ["Guest Name", "Name"],
  mobile: ["Mobile", "Phone", "Contact", "Mobile No", "Phone No", "Mobile Number"],
  email: ["Email"],
  check_in: ["Check In", "Check-In", "Check in", "Arrival", "Arrival Date", "Checkin"],
  check_out: ["Check Out", "Check-Out", "Check out", "Departure", "Departure Date", "Checkout"],
  guests: ["Guest Count", "Guests", "Adults", "No of Guests", "Number of Guests"],
  room_details: ["Room Name", "Room Type", "Room Details", "Room"],
  room_charges: ["Room Charges", "Room Total", "Room Tariff", "Room Price", "Room Amount"],
  subtotal: ["Subtotal", "Sub Total", "Sub-Total"],
  discount: ["Discount", "Discount Amount", "Coupon Discount"],
  taxable_amount: ["Taxable Amount", "Taxable Value", "Net Amount"],
  tax: ["Tax", "Taxes", "GST", "Total Tax", "Total Taxes"],
  total_amount: ["Discounted Total", "Total Amount", "Grand Total", "Total Price", "Total Booking Amount"],
  amount_paid: ["Amount Paid", "Paid", "Advance Paid", "Advance"],
  balance_due: ["Amount To Pay", "Balance Due", "Balance", "Amount Due", "Due Amount"],
  rooms: OTA_ROOM_LABELS,
  payment_mode: OTA_PAYMENT_LABELS,
  booking_status: ["Booking Status", "Status"],
  special_requests: ["Special Requests", "Special Request", "Guest Requests", "Notes"],
};

export const FABHOTELS_DEFAULTS: Record<string, string[]> = {
  booking_id: ["Booking ID", "Booking Id"],
  guest_name: ["NAME OF GUEST", "Name of Guest", "Guest Name"],
  mobile: ["Mobile", "Phone", "Contact"],
  email: ["Email"],
  check_in: ["CHECKIN DATE", "Checkin Date", "Check-in Date", "Check In", "Arrival Date"],
  check_out: ["CHECKOUT DATE", "Checkout Date", "Check-out Date", "Check Out", "Departure Date"],
  guests: ["TOTAL GUESTS", "Total Guests", "Number Of Guests", "Guests"],
  room_details: ["TYPE OF ROOM", "Type Of Room", "Room Type", "Room Name"],
  total_amount: ["TOTAL BOOKING AMOUNT", "Total Booking Amount", "Total Amount", "Total"],
  amount_paid: ["Amount Paid", "Paid"],
  rooms: OTA_ROOM_LABELS,
  payment_mode: OTA_PAYMENT_LABELS,
  booking_status: ["Booking Status", "Status"],
  special_requests: ["SPECIAL REQUEST", "Special Request", "Special Requests", "Notes"],
  hotel_name: ["HOTEL NAME & ADDRESS", "Hotel Name"],
};

export function parseGeneric(
  text: string,
  subject: string,
  defaults: Record<string, string[]>,
  fieldLabels: Record<string, string[]>,
  opts?: { statusFromSubject?: boolean } & ParserOptions,
): { booking: ParsedBooking | null; errors: string[] } {
  const lbl = (k: string) => (fieldLabels[k]?.length ? fieldLabels[k] : defaults[k] ?? []);
  const guestSection = extractGuestDetailsSection(text);
  const identityTexts = [guestSection, text].filter((v): v is string => !!v);

  const bookingId =
    pickByLabels(text, lbl("booking_id")) ??
    pick(subject, /Booking\s*(?:ID|Id|No|Number|Reference)[^A-Z0-9]*([A-Z0-9-]*\d[A-Z0-9-]*)/i) ??
    pick(subject, /Booking[^A-Z0-9]*([A-Z0-9-]*\d[A-Z0-9-]*)/i);
  const name = pickFirstByLabelsFromTexts(identityTexts, lbl("guest_name"));
  const mobileCandidates = pickAllByLabelsFromTexts(identityTexts, lbl("mobile"));
  const emailCandidates = pickAllByLabelsFromTexts(identityTexts, lbl("email"));
  const checkInRaw = pickByLabels(text, lbl("check_in"));
  const checkOutRaw = pickByLabels(text, lbl("check_out"));
  const checkIn = normalizeDate(checkInRaw);
  const checkOut = normalizeDate(checkOutRaw);
  const guestCount = pickByLabels(text, lbl("guests"));
  const paymentMode = pickByLabels(text, lbl("payment_mode")) ?? pick(text, /Payment\s*Mode\s*[:\-|]\s*([^\n|]+?)(?=\n|\||$)/i);
  const subjectLc = subject.toLowerCase();
  let bookingStatus = pickByLabels(text, lbl("booking_status"));
  if (!bookingStatus && opts?.statusFromSubject) {
    if (subjectLc.includes("cancel")) bookingStatus = "Cancelled";
    else if (subjectLc.includes("confirm") || subjectLc.includes("reservation")) bookingStatus = "Confirmed";
    else bookingStatus = "Pending Confirmation";
  }
  // Money fields — pick the LAST occurrence to skip table-column-header false matches
  // (e.g. "Total Price" appearing in a `<th>` before the actual labelled value).
  const lastMoney = (key: string): string | null => {
    const all = pickAllByLabels(text, lbl(key)).filter((v) => /\d/.test(v));
    return all.length ? all[all.length - 1] : null;
  };
  const totalAmount = lastMoney("total_amount");
  const amountPaid = lastMoney("amount_paid");
  const balanceDue = lastMoney("balance_due");
  const roomCharges = lastMoney("room_charges");
  const subtotalRaw = lastMoney("subtotal");
  const taxableRaw = lastMoney("taxable_amount");
  const discount = lastMoney("discount");
  const tax = lastMoney("tax");
  const specialReq = pickByLabels(text, lbl("special_requests"));
  const roomDetails = pickByLabels(text, lbl("room_details")) ?? "";

  const errors: string[] = [];
  if (!bookingId) errors.push("missing booking id");
  if (!name) errors.push("missing guest name");
  if (!checkIn) errors.push(`missing/invalid check-in${checkInRaw ? ` (${checkInRaw})` : ""}`);
  if (!checkOut) errors.push(`missing/invalid check-out${checkOutRaw ? ` (${checkOutRaw})` : ""}`);
  if (!bookingId || !name || !checkIn || !checkOut) return { booking: null, errors };

  const guestPhone = pickGuestPhone(mobileCandidates, identityTexts);
  const guestEmail = pickGuestEmail(emailCandidates, identityTexts, opts?.blockedEmails);

  return {
    booking: {
      external_ref: bookingId,
      guest_name: name.replace(/\s*\([^)]*\)\s*$/, "").trim(),
      phone: guestPhone,
      email: guestEmail,
      check_in: checkIn,
      check_out: checkOut,
      guests: guestCount ? parseInt(guestCount, 10) || 1 : 1,
      room_details: roomDetails.trim(),
      rooms: pickByLabels(text, lbl("rooms")),
      room_charges: parseMoney(roomCharges),
      subtotal: parseMoney(subtotalRaw),
      discount: parseMoney(discount),
      taxable_amount: parseMoney(taxableRaw),
      tax: parseMoney(tax),
      total_amount: parseMoney(totalAmount),
      amount_paid: parseMoney(amountPaid),
      balance_due: parseMoney(balanceDue),
      payment_mode: paymentMode?.trim() ?? null,
      booking_status: (bookingStatus ?? "Pending Confirmation").trim(),
      special_requests: specialReq && !/^none$/i.test(specialReq) ? specialReq.trim() : null,
    },
    errors: [],
  };
}

type ProviderParser = (text: string, subject: string, fieldLabels: Record<string, string[]>, opts?: ParserOptions) => { booking: ParsedBooking | null; errors: string[] };

export const PARSERS: Record<string, ProviderParser> = {
  hotelzify: (text, subject, fl, opts) => parseGeneric(text, subject, HOTELZIFY_DEFAULTS, fl, { statusFromSubject: true, ...opts }),
  fabhotels: (text, subject, fl, opts) => parseGeneric(text, subject, FABHOTELS_DEFAULTS, fl, { statusFromSubject: true, ...opts }),
};


export { isReceptionPhone };
