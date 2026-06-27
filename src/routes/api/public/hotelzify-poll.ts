/**
 * Generic email-integration polling endpoint.
 *
 * URL: /api/public/hotelzify-poll  (kept for backwards compatibility / pg_cron)
 *
 * Behavior:
 *   - Optional ?integration_id=<uuid>  → process only that integration
 *   - Otherwise iterates over every email_parser integration with status in (connected, draft)
 *   - Provider-specific parsers are registered in PARSERS below.
 *   - sender_email + inbox_email + subject_filters + field_labels all come from the integration
 *     row's `config` JSON — there are NO hardcoded sender/inbox defaults.
 *   - Dedupe via external_bookings (integration_id, external_ref).
 */
import { createFileRoute } from "@tanstack/react-router";
import { normalizePhoneNumber, validatePhoneNumber } from "@/lib/phone";

const GMAIL_BASE = "https://connector-gateway.lovable.dev/google_mail/gmail/v1";

type ParsedBooking = {
  external_ref: string;
  guest_name: string;
  phone: string | null;
  email: string | null;
  check_in: string;
  check_out: string;
  guests: number;
  room_details: string;
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

type HeaderSample = { id?: string; date: string; from: string; subject: string };
type DiagnosticSearch = { query: string; count: number; resultSizeEstimate: number; samples: HeaderSample[]; error?: string };
type ParserOptions = { blockedEmails?: string[] };
type ImportTrace = {
  external_ref: string;
  gmail_message_id: string;
  subject: string;
  action: "create" | "update" | "skip" | "repair_existing_contact";
  parsed_payload: Record<string, unknown>;
  database_payload: Record<string, unknown>;
  customer_payload: Record<string, unknown> | null;
  contact_repair_payload?: Record<string, unknown> | null;
};

function decodeB64Url(s: string): string {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(b64, "base64").toString("utf-8");
}

function extractTextFromPayload(payload: any): string {
  if (!payload) return "";
  const parts: string[] = [];
  const walk = (p: any) => {
    if (p.body?.data) {
      const decoded = decodeB64Url(p.body.data);
      if (p.mimeType === "text/plain" || p.mimeType === "text/html") parts.push(decoded);
    }
    if (Array.isArray(p.parts)) p.parts.forEach(walk);
  };
  walk(payload);
  let text = parts.join("\n");
  text = text.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<script[\s\S]*?<\/script>/gi, " ");
  text = text.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|tr|li|h\d)>/gi, "\n").replace(/<\/td>/gi, " | ");
  text = text.replace(/<[^>]+>/g, " ");
  text = text.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'").replace(/&quot;/g, '"');
  text = text.replace(/[ \t]+/g, " ").replace(/\n{2,}/g, "\n").trim();
  return text;
}

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
  return candidates.find((e) => !blocked.has(e)) ?? null;
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

const HOTELZIFY_DEFAULTS: Record<string, string[]> = {
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
  payment_mode: ["Payment Mode", "Mode of Payment", "Payment Method"],
  booking_status: ["Booking Status", "Status"],
  special_requests: ["Special Requests", "Special Request", "Guest Requests", "Notes"],
};

const FABHOTELS_DEFAULTS: Record<string, string[]> = {
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
  payment_mode: ["PAYMENT MODE", "Payment Mode"],
  booking_status: ["Booking Status", "Status"],
  special_requests: ["SPECIAL REQUEST", "Special Request", "Special Requests", "Notes"],
  hotel_name: ["HOTEL NAME & ADDRESS", "Hotel Name"],
};

function parseGeneric(
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

  // Identity fields must prefer the Guest Details block. Hotelzify emails also contain the
  // hotel's own Contact/Email before the guest block; scanning the whole email first stores
  // the reception contact instead of the guest contact.
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
      room_charges: parseMoney(roomCharges),
      discount: parseMoney(discount),
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

const PARSERS: Record<string, ProviderParser> = {
  hotelzify: (text, subject, fl, opts) => parseGeneric(text, subject, HOTELZIFY_DEFAULTS, fl, { statusFromSubject: true, ...opts }),
  fabhotels: (text, subject, fl, opts) => parseGeneric(text, subject, FABHOTELS_DEFAULTS, fl, { statusFromSubject: true, ...opts }),
};

function maskPhone(value: unknown): unknown {
  if (typeof value !== "string" || !value) return value;
  const digits = value.replace(/\D/g, "");
  if (digits.length < 10) return value;
  return `+91${"*".repeat(8)}${digits.slice(-2)}`;
}

function maskEmail(value: unknown): unknown {
  if (typeof value !== "string" || !value) return value;
  return value.replace(/(^.).*(@.*$)/, "$1***$2");
}

function maskedParsedPayload(parsed: ParsedBooking): Record<string, unknown> {
  return { ...parsed, phone: maskPhone(parsed.phone), email: maskEmail(parsed.email) };
}

function maskedDatabasePayload(payload: Record<string, unknown>): Record<string, unknown> {
  return { ...payload, phone: maskPhone(payload.phone), email: maskEmail(payload.email) };
}

function contactPatchFromParsed(current: { phone?: string | null; email?: string | null } | null | undefined, parsed: ParsedBooking, blockedEmails: string[] = []) {
  const patch: Record<string, string> = {};
  const currentEmail = current?.email?.trim().toLowerCase() ?? "";
  const blocked = new Set(blockedEmails.map((e) => e.trim().toLowerCase()).filter(Boolean));
  if (parsed.phone && (!current?.phone || isReceptionPhone(current.phone))) patch.phone = parsed.phone;
  if (parsed.email && (!currentEmail || blocked.has(currentEmail))) patch.email = parsed.email;
  return patch;
}

function mapStatus(s: string): string {
  const lc = s.toLowerCase();
  if (lc.includes("cancel")) return "Cancelled";
  if (lc.includes("confirm")) return "Confirmed";
  return "Pending";
}

// ---------- Gmail helpers ----------

async function gmailFetch(path: string, gatewayKey: string, connectionKey: string, init?: RequestInit): Promise<any> {
  const res = await fetch(`${GMAIL_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${gatewayKey}`,
      "X-Connection-Api-Key": connectionKey,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gmail ${path} ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

function isGmailMetadataOnlyError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error ?? "");
  const lc = msg.toLowerCase();
  return lc.includes("metadata scope does not support") || lc.includes("metadata scope doesn't allow");
}

function formatMetadataOnlyMessage(gmailAccount: string | null, matched: number): string {
  return [
    `Gmail account ${gmailAccount ?? "unknown"} is connected and headers are reachable, but Gmail is treating the active OAuth token as metadata-only.`,
    `The parser can list recent email headers${matched > 0 ? ` and found ${matched} sender/subject match${matched === 1 ? "" : "es"}` : ""}, but Google is blocking both search queries and full message bodies.`,
    "Do not keep reconnecting from the integration screen; the selected scopes are not the problem. The Gmail connector token needs to be refreshed/reissued with effective gmail.readonly body access before imports can create bookings.",
  ].join(" ");
}

function headersMap(msg: any): Record<string, string> {
  const headers: { name: string; value: string }[] = msg.payload?.headers ?? [];
  return Object.fromEntries(headers.map((h) => [h.name.toLowerCase(), h.value]));
}

function fromMatchesSender(from: string, sender?: string): boolean {
  if (!sender) return true;
  return from.toLowerCase().includes(sender.toLowerCase());
}

function subjectMatchesFilters(subject: string, subjectFilters: string[]): boolean {
  if (subjectFilters.length === 0) return true;
  const lc = subject.toLowerCase();
  return subjectFilters.some((f) => lc.includes(f.toLowerCase()));
}

async function scanMetadataOnlyFallback(
  gatewayKey: string,
  connectionKey: string,
  sender: string | undefined,
  subjectFilters: string[],
): Promise<{ scanned: number; matched: number; samples: HeaderSample[] }> {
  const list = await gmailFetch("/users/me/messages?maxResults=50&labelIds=INBOX", gatewayKey, connectionKey);
  const messages: { id: string }[] = list.messages ?? [];
  const samples: HeaderSample[] = [];
  let matched = 0;

  for (const m of messages) {
    const msg = await gmailFetch(
      `/users/me/messages/${m.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
      gatewayKey,
      connectionKey,
    );
    const h = headersMap(msg);
    const sample = { id: m.id, date: h.date ?? "", from: h.from ?? "", subject: h.subject ?? "" };
    const isMatch = fromMatchesSender(sample.from, sender) && subjectMatchesFilters(sample.subject, subjectFilters);
    if (isMatch) {
      matched++;
      if (samples.length < 5) samples.push(sample);
    } else if (samples.length < 5 && matched === 0) {
      samples.push(sample);
    }
  }

  return { scanned: messages.length, matched, samples };
}

async function getGmailProfile(gatewayKey: string, connectionKey: string): Promise<string | null> {
  try {
    const profile = await gmailFetch("/users/me/profile", gatewayKey, connectionKey);
    return profile.emailAddress ?? null;
  } catch { return null; }
}

async function runDiagnosticSearch(query: string, gatewayKey: string, connectionKey: string): Promise<DiagnosticSearch> {
  try {
    const list = await gmailFetch(`/users/me/messages?maxResults=5&q=${encodeURIComponent(query)}`, gatewayKey, connectionKey);
    const messages: { id: string }[] = list.messages ?? [];
    const samples: HeaderSample[] = [];
    for (const m of messages.slice(0, 5)) {
      const msg = await gmailFetch(`/users/me/messages/${m.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`, gatewayKey, connectionKey);
      const h = headersMap(msg);
      samples.push({ id: m.id, date: h.date ?? "", from: h.from ?? "", subject: h.subject ?? "" });
    }
    return { query, count: messages.length, resultSizeEstimate: list.resultSizeEstimate ?? messages.length, samples };
  } catch (e: any) {
    return { query, count: 0, resultSizeEstimate: 0, samples: [], error: e.message?.slice(0, 300) ?? String(e) };
  }
}

// ---------- Per-integration runner ----------

type RunResult = {
  integration_id: string;
  provider: string;
  ok: boolean;
  gmail_account: string | null;
  query: string;
  scanned: number;
  matched: number;
  parsed: number;
  created: number;
  updated: number;
  errors: string[];
  parser_errors: string[];
  first_5_email_subjects_seen: HeaderSample[];
  diagnostic_searches?: DiagnosticSearch[];
  gmail_access_mode?: "full" | "metadata_only";
  traces?: ImportTrace[];
  fatal?: string;
};

async function processIntegration(
  intg: any,
  supabaseAdmin: any,
  gatewayKey: string,
  connectionKey: string,
  debug: boolean,
  dryRun: boolean = false,
): Promise<RunResult> {
  const provider: string = intg.provider;
  const parser = PARSERS[provider];

  const cfg = (intg.config ?? {}) as any;
  const sender: string | undefined = cfg.sender_email?.trim() || undefined;
  const subjectFilters: string[] = Array.isArray(cfg.subject_filters) ? cfg.subject_filters : [];
  const days = cfg.lookback_days ?? 30;
  const customQuery: string | undefined = cfg.search_query;
  const leadSource: string = cfg.lead_source ?? (provider === "hotelzify" ? "Hotelzify" : provider === "fabhotels" ? "FabHotels" : provider);
  const blockedEmails: string[] = [cfg.inbox_email, cfg.hotel_email, cfg.property_email].filter((v): v is string => typeof v === "string" && !!v.trim());
  // When false (default), bookings that already exist (by external_ref) are skipped — never patched.
  // When true, only safe fields (amount, status, special_requests) are patched; guest identity is never overwritten.
  const allowUpdates: boolean = cfg.allow_updates === true;

  const fieldLabels: Record<string, string[]> = (() => {
    const raw = cfg.field_labels ?? {};
    const out: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(raw)) {
      if (Array.isArray(v)) out[k] = (v as any[]).filter((x): x is string => typeof x === "string" && !!x.trim());
      else if (typeof v === "string") out[k] = v.split(",").map((s) => s.trim()).filter(Boolean);
    }
    return out;
  })();

  const result: RunResult = {
    integration_id: intg.id,
    provider,
    ok: false,
    gmail_account: null,
    query: customQuery ?? (sender ? `from:${sender} newer_than:${days}d` : ""),
    scanned: 0, matched: 0, parsed: 0, created: 0, updated: 0,
    errors: [], parser_errors: [], first_5_email_subjects_seen: [],
    gmail_access_mode: "full",
    traces: debug ? [] : undefined,
  };

  if (!parser) {
    result.fatal = `No parser registered for provider "${provider}"`;
    return result;
  }
  if (!sender && !customQuery) {
    result.fatal = "sender_email is required (configure it in the integration UI)";
    return result;
  }

  const runStart = new Date().toISOString();
  const gmailQuery = customQuery ?? `from:${sender} newer_than:${days}d`;
  result.query = gmailQuery;

  try {
    result.gmail_account = await getGmailProfile(gatewayKey, connectionKey);

    let list: any;
    try {
      list = await gmailFetch(`/users/me/messages?maxResults=50&q=${encodeURIComponent(gmailQuery)}`, gatewayKey, connectionKey);
    } catch (e: any) {
      if (!isGmailMetadataOnlyError(e)) throw e;

      result.gmail_access_mode = "metadata_only";
      const fallback = await scanMetadataOnlyFallback(gatewayKey, connectionKey, sender, subjectFilters);
      result.scanned = fallback.scanned;
      result.matched = fallback.matched;
      result.first_5_email_subjects_seen = fallback.samples;
      result.fatal = formatMetadataOnlyMessage(result.gmail_account, fallback.matched);

      if (!dryRun) {
        const excerpt = [
          `Provider: ${provider}`,
          `Gmail account: ${result.gmail_account ?? "unknown"}`,
          `Query attempted: ${gmailQuery}`,
          `Access mode: metadata_only`,
          `Recent headers scanned: ${result.scanned}`,
          `Header matches: ${result.matched}`,
          `Header samples:\n${result.first_5_email_subjects_seen.map((s) => `- From: ${s.from || "—"} | Subject: ${s.subject || "—"}`).join("\n") || "(none)"}`,
          result.fatal,
        ].join("\n").slice(0, 5000);
        await supabaseAdmin.from("integration_runs").insert({
          integration_id: intg.id,
          started_at: runStart,
          finished_at: new Date().toISOString(),
          status: "error",
          message: `metadata-only Gmail token · scanned ${result.scanned} headers · matched ${result.matched}`,
          created_count: 0,
          updated_count: 0,
          payload_excerpt: excerpt,
        } as any);
        await supabaseAdmin.from("integrations").update({
          last_sync_at: new Date().toISOString(),
          last_sync_status: "error",
          last_sync_message: result.fatal,
        } as any).eq("id", intg.id);
      }

      return result;
    }
    const messages: { id: string }[] = list.messages ?? [];
    result.scanned = messages.length;

    if (messages.length === 0 && debug && sender) {
      result.diagnostic_searches = [];
      for (const q of [
        gmailQuery,
        `in:anywhere from:${sender} newer_than:${days}d`,
        `in:anywhere ${sender} newer_than:365d`,
      ]) result.diagnostic_searches.push(await runDiagnosticSearch(q, gatewayKey, connectionKey));
    }

    for (const m of messages) {
      try {
        let msg: any;
        try {
          msg = await gmailFetch(`/users/me/messages/${m.id}?format=full`, gatewayKey, connectionKey);
        } catch (e: any) {
          if (isGmailMetadataOnlyError(e)) {
            result.gmail_access_mode = "metadata_only";
            result.fatal = formatMetadataOnlyMessage(result.gmail_account, result.matched);
            throw new Error(result.fatal);
          }
          throw e;
        }
        const headers = headersMap(msg);
        const subject = headers.subject ?? "";
        const from = headers.from ?? "";
        if (result.first_5_email_subjects_seen.length < 5) {
          result.first_5_email_subjects_seen.push({ id: m.id, date: headers.date ?? "", from, subject });
        }

        if (subjectFilters.length > 0) {
          const lc = subject.toLowerCase();
          if (!subjectFilters.some((f) => lc.includes(f.toLowerCase()))) continue;
        }
        result.matched++;

        const text = extractTextFromPayload(msg.payload);
        const parseRes = parser(text, subject, fieldLabels, { blockedEmails });
        if (!parseRes.booking) {
          const reason = parseRes.errors.join("; ") || "parse failed";
          result.parser_errors.push(`msg ${m.id} ("${subject.slice(0, 60)}"): ${reason}`);
          continue;
        }
        const parsed = parseRes.booking;
        result.parsed++;

        const { data: existing } = await supabaseAdmin
          .from("bookings")
          .select("id, phone, email, customer_id")
          .eq("integration_id", intg.id)
          .eq("external_ref", parsed.external_ref)
          .maybeSingle();

        let customerId: string | null = existing?.customer_id ?? null;
        let customerRow: { id: string; phone: string | null; email: string | null } | null = null;
        if (customerId) {
          const { data: cust } = await supabaseAdmin
            .from("customers").select("id, phone, email").eq("id", customerId).maybeSingle();
          if (cust) customerRow = cust;
          else customerId = null;
        }
        if (!customerId && parsed.phone) {
          const { data: cust } = await supabaseAdmin
            .from("customers").select("id, phone, email").eq("phone", parsed.phone).limit(1).maybeSingle();
          if (cust) {
            customerRow = cust;
            customerId = cust.id;
          }
        }
        if (!customerId && parsed.email) {
          const { data: cust } = await supabaseAdmin
            .from("customers").select("id, phone, email").ilike("email", parsed.email).limit(1).maybeSingle();
          if (cust) {
            customerRow = cust;
            customerId = cust.id;
          }
        }

        const { data: anyUser } = await supabaseAdmin
          .from("user_roles").select("user_id").eq("role", "admin").limit(1).maybeSingle();
        const systemUserId = anyUser?.user_id;
        if (!systemUserId && !dryRun) throw new Error("No admin user to attribute booking");

        let customerPayload: Record<string, unknown> | null = null;
        let customerContactPatch: Record<string, string> = {};
        if (!customerId) {
          customerPayload = {
            user_id: systemUserId,
            guest_name: parsed.guest_name,
            phone: parsed.phone,
            email: parsed.email,
            lead_source: leadSource,
          };
          if (!dryRun) {
            const { data: newCust, error: custErr } = await supabaseAdmin
              .from("customers")
              .insert(customerPayload as any)
              .select("id, phone, email").single();
            if (custErr) throw custErr;
            customerId = newCust!.id;
            customerRow = newCust;
          }
        } else if (customerId && !dryRun) {
          customerContactPatch = contactPatchFromParsed(customerRow, parsed, blockedEmails);
          if (Object.keys(customerContactPatch).length > 0) {
            const { data: patchedCustomer, error: patchCustomerErr } = await supabaseAdmin
              .from("customers")
              .update(customerContactPatch as any)
              .eq("id", customerId)
              .select("id, phone, email")
              .single();
            if (patchCustomerErr) throw patchCustomerErr;
            customerRow = patchedCustomer;
          }
        }

        // Pricing breakdown reconciliation.
        // The Pricing Summary card on the booking detail reads from booking_items + the
        // `discount`, `tax_rate`, `taxes_included`, and `total_override` columns. To make
        // Room Charges, Subtotal, Discount, and Taxable Amount display correctly for
        // imported OTA bookings we:
        //   1. Insert one synthetic booking_items row with rate = roomChargesBase / nights
        //      → drives Main Stay Charges + Subtotal
        //   2. Persist `discount`              → drives Discount row
        //   3. Persist `tax_rate` derived from parsed tax / taxable base
        //      → drives Taxable Amount and Tax rows
        //   4. Persist `amount` = parsed total → Final Booking Amount
        const totalPayable = parsed.total_amount || 0;
        const checkInDate = new Date(parsed.check_in);
        const checkOutDate = new Date(parsed.check_out);
        const nights = Math.max(
          1,
          Math.round((checkOutDate.getTime() - checkInDate.getTime()) / 86_400_000),
        );
        const discountAmount = parsed.discount || 0;
        // Prefer explicit Room Charges from the email. Fall back to total − tax + discount
        // (i.e. the pre-tax, gross-of-discount figure), else the total itself.
        const roomChargesBase =
          parsed.room_charges > 0
            ? parsed.room_charges
            : Math.max(0, totalPayable - (parsed.tax || 0) + discountAmount) || totalPayable;
        const taxableBase = Math.max(0, roomChargesBase - discountAmount);
        const derivedTaxRate =
          parsed.tax > 0 && taxableBase > 0
            ? Number((parsed.tax / taxableBase).toFixed(4))
            : 0;
        const perNightRate = Math.max(0, Math.round(roomChargesBase / nights));

        const bookingPayload = {
          user_id: systemUserId,
          customer_id: customerId,
          guest_name: parsed.guest_name,
          phone: parsed.phone,
          email: parsed.email,
          check_in: parsed.check_in,
          check_out: parsed.check_out,
          adults: parsed.guests,
          guests: parsed.guests,
          room_details: parsed.room_details,
          amount: totalPayable,
          subtotal: roomChargesBase,
          discount: discountAmount,
          taxes: parsed.tax || 0,
          tax_rate: derivedTaxRate,
          taxes_included: false,
          total_override: null,
          advance_paid: parsed.amount_paid || 0,
          status: mapStatus(parsed.booking_status),
          lead_source: leadSource,
          integration_id: intg.id,
          external_ref: parsed.external_ref,
          special_requests: parsed.special_requests,
          notes: `Imported from ${leadSource} · Booking #${parsed.external_ref}${parsed.payment_mode ? ` · ${parsed.payment_mode}` : ""}`,
        };
        const syntheticItem = {
          position: 0,
          room_type: parsed.room_details?.trim() || "Imported Room",
          rooms: 1,
          adults: Math.max(1, parsed.guests || 1),
          children: 0,
          check_in: parsed.check_in,
          check_out: parsed.check_out,
          breakfast_included: false,
          extra_bed: 0,
          rate: perNightRate,
          subtotal: perNightRate * nights,
          notes: null,
          early_check_in: false,
          early_check_in_slot: null,
          late_check_out: false,
          late_check_out_slot: null,
          pet_size: "none",
          extra_adults: 0,
          drivers: 0,
        };
        const trace: ImportTrace = {
          external_ref: parsed.external_ref,
          gmail_message_id: m.id,
          subject,
          action: existing ? (allowUpdates ? "update" : "skip") : "create",
          parsed_payload: maskedParsedPayload(parsed),
          database_payload: maskedDatabasePayload({ ...bookingPayload, _booking_item: syntheticItem }),
          customer_payload: customerPayload ? maskedDatabasePayload(customerPayload) : (Object.keys(customerContactPatch).length > 0 ? maskedDatabasePayload(customerContactPatch) : null),
        };
        if (debug) result.traces?.push(trace);
        let bookingIdForExternal = existing?.id ?? null;
        let contactRepairPayload: Record<string, string> = {};

        if (existing) {
          if (!allowUpdates) {
            // Dedupe-skip: existing booking, updates disabled in integration config.
            // Exception: safely fill contact fields that are currently empty, because
            // staff cannot use imported bookings when mobile/email were lost in an older run.
            contactRepairPayload = contactPatchFromParsed(existing, parsed, blockedEmails);
            if (Object.keys(contactRepairPayload).length > 0 && !dryRun) {
              const { error: repairErr } = await supabaseAdmin
                .from("bookings")
                .update(contactRepairPayload as any)
                .eq("id", existing.id);
              if (repairErr) throw repairErr;
              trace.action = "repair_existing_contact";
              trace.contact_repair_payload = maskedDatabasePayload(contactRepairPayload);
              result.updated++;
            } else {
              result.parser_errors.push(`msg ${m.id} ("${subject.slice(0, 60)}"): skipped — booking exists (updates disabled)`);
            }
          } else {
            if (!dryRun) {
              // Patch financial + status fields. Never overwrite guest identity,
              // phone, room assignment, or staff notes — those are owned by the PMS once created.
              await supabaseAdmin.from("bookings").update({
                amount: bookingPayload.amount,
                subtotal: bookingPayload.subtotal,
                discount: bookingPayload.discount,
                taxes: bookingPayload.taxes,
                tax_rate: bookingPayload.tax_rate,
                taxes_included: bookingPayload.taxes_included,
                total_override: bookingPayload.total_override,
                advance_paid: bookingPayload.advance_paid,
                status: bookingPayload.status,
                special_requests: bookingPayload.special_requests,
                ...contactPatchFromParsed(existing, parsed, blockedEmails),
              } as any).eq("id", existing.id);
              // Refresh the synthetic line item so Room Charges stays in sync.
              await supabaseAdmin.from("booking_items").delete().eq("booking_id", existing.id);
              await supabaseAdmin.from("booking_items").insert({
                booking_id: existing.id,
                ...syntheticItem,
              } as any);
            }
            result.updated++;
          }
        } else {
          if (!dryRun) {
            const { data: insertedBooking, error: insertBookingErr } = await supabaseAdmin
              .from("bookings")
              .insert(bookingPayload as any)
              .select("id")
              .single();
            if (insertBookingErr) throw insertBookingErr;
            bookingIdForExternal = insertedBooking.id;
            // Insert synthetic line item so the Pricing Summary shows Room Charges,
            // Subtotal, Discount, Taxable Amount, and Tax derived from one consistent base.
            const { error: itemErr } = await supabaseAdmin
              .from("booking_items")
              .insert({ booking_id: insertedBooking.id, ...syntheticItem } as any);
            if (itemErr) {
              result.parser_errors.push(`msg ${m.id}: booking created but line item failed (${itemErr.message?.slice(0, 120)})`);
            }
          }
          result.created++;
        }

        if (!dryRun) {
          await supabaseAdmin.from("external_bookings").upsert({
            integration_id: intg.id,
            external_ref: parsed.external_ref,
            raw_payload: { subject, parsed, gmail_message_id: m.id, trace },
            parsed,
            booking_id: bookingIdForExternal,
            state: "processed",
          } as any, { onConflict: "integration_id,external_ref" });
        }
      } catch (e: any) {
        if (result.gmail_access_mode === "metadata_only" && result.fatal) {
          throw e;
        }
        result.errors.push(`msg ${m.id}: ${e.message?.slice(0, 200)}`);
      }
    }

    result.ok = true;

    // Dry-run: don't touch integrations/integration_runs at all. Caller renders the preview.
    if (dryRun) {
      return result;
    }

    const summary = `query="${gmailQuery}" · scanned ${result.scanned} · matched ${result.matched} · parsed ${result.parsed} · created ${result.created} · updated ${result.updated}${result.errors.length ? ` · ${result.errors.length} errors` : ""}`;

    await supabaseAdmin.from("integrations").update({
      status: "connected",
      last_sync_at: new Date().toISOString(),
      last_sync_status: result.errors.length === 0 ? "success" : "partial",
      last_sync_message: `Scanned ${result.scanned} · matched ${result.matched} · parsed ${result.parsed} · created ${result.created} · updated ${result.updated}${result.errors.length ? ` · ${result.errors.length} err` : ""}`,
      bookings_imported: (intg.bookings_imported ?? 0) + result.created,
    } as any).eq("id", intg.id);

    const excerpt = [
      `Provider: ${provider}`,
      `Gmail account: ${result.gmail_account ?? "unknown"}`,
      `Query: ${gmailQuery}`,
      `Emails Scanned: ${result.scanned}`,
      `Emails Matched: ${result.matched}`,
      `Emails Parsed: ${result.parsed}`,
      `Bookings Created: ${result.created}`,
      `Bookings Updated: ${result.updated}`,
      `First 5 email subjects/senders seen:\n${result.first_5_email_subjects_seen.map((s) => `- From: ${s.from || "—"} | Subject: ${s.subject || "—"}`).join("\n") || "(none)"}`,
      result.parser_errors.length ? `Parser errors:\n${result.parser_errors.slice(0, 8).join("\n")}` : "",
      result.errors.length ? `Errors:\n${result.errors.slice(0, 8).join("\n")}` : "",
    ].filter(Boolean).join("\n").slice(0, 5000);

    await supabaseAdmin.from("integration_runs").insert({
      integration_id: intg.id,
      started_at: runStart,
      finished_at: new Date().toISOString(),
      status: result.errors.length === 0 ? "success" : result.created + result.updated > 0 ? "partial" : "error",
      message: summary,
      created_count: result.created,
      updated_count: result.updated,
      payload_excerpt: excerpt,
    } as any);
  } catch (e: any) {
    result.fatal = e.message?.slice(0, 300) ?? String(e);
    await supabaseAdmin.from("integration_runs").insert({
      integration_id: intg.id,
      started_at: runStart,
      finished_at: new Date().toISOString(),
      status: "error",
      message: `query="${gmailQuery}" · ${result.fatal}`,
      created_count: result.created,
      updated_count: result.updated,
      payload_excerpt: `Provider: ${provider}\nQuery: ${gmailQuery}\n${result.fatal}`,
    } as any);
    await supabaseAdmin.from("integrations").update({
      last_sync_at: new Date().toISOString(),
      last_sync_status: "error",
      last_sync_message: result.fatal,
    } as any).eq("id", intg.id);
  }
  return result;
}

export const Route = createFileRoute("/api/public/hotelzify-poll")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const gatewayKey = process.env.LOVABLE_API_KEY;
        const connectionKey = process.env.GOOGLE_MAIL_API_KEY;
        // Gmail is required ONLY for the email-fetch step of email-parser
        // integrations (FabHotels, Hotelzify, OYO, etc.). It is not part of
        // the FabHotels configuration itself — connecting/disconnecting Gmail
        // does NOT mutate FabHotels rows, and FabHotels can be created,
        // edited, and saved without Gmail. We surface a structured error so
        // the integration editor can show a "Connect Gmail" CTA inline
        // without treating the FabHotels config as broken.
        if (!gatewayKey || !connectionKey) {
          return Response.json({
            ok: false,
            code: "gmail_not_connected",
            error: "Gmail is not connected to Lovable. Email-parser integrations (FabHotels, Hotelzify, OYO) all read confirmation emails from the single Gmail account you connect here — the same address shown as 'Inbox Email' on this integration (e.g. hotelexcellavizag@gmail.com). Connect Gmail under Settings → Connections, then run this sync again. Your integration configuration is unaffected.",
          }, { status: 400 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const url = new URL(request.url);
        const debug = url.searchParams.get("debug") === "1";
        const integrationId = url.searchParams.get("integration_id");
        // dryRun=1: identical pipeline (Gmail fetch, parse, dedupe) but NO
        // writes to bookings/customers/external_bookings/integration_runs.
        // Returns the same counts so the UI can render a "Would create/update"
        // preview before staff hit Import. Used by the "Run Preview" button.
        const dryRun = url.searchParams.get("dryRun") === "1";

        let query = supabaseAdmin
          .from("integrations")
          .select("*")
          .eq("type", "email_parser")
          .in("status", ["connected", "draft", "disabled"]); // dry-run should also work on disabled integrations
        if (integrationId) query = query.eq("id", integrationId);
        const { data: rows, error: intgErr } = await query.order("updated_at", { ascending: false });

        if (intgErr) {
          return Response.json({ ok: false, error: intgErr.message }, { status: 500 });
        }
        if (!rows || rows.length === 0) {
          return Response.json({ ok: false, error: "No matching email_parser integration" }, { status: 404 });
        }

        const results: RunResult[] = [];
        for (const intg of rows) {
          results.push(await processIntegration(intg, supabaseAdmin, gatewayKey, connectionKey, debug, dryRun));
        }

        // When called for a specific integration, flatten to the legacy single-result shape
        if (integrationId && results.length === 1) {
          const r = results[0];
          return Response.json({
            ok: !r.fatal,
            dryRun,
            integration_id: r.integration_id,
            provider: r.provider,
            gmail_account: r.gmail_account,
            gmail_access_mode: r.gmail_access_mode,
            query: r.query,
            scanned: r.scanned, matched: r.matched, parsed: r.parsed,
            created: r.created, updated: r.updated,
            errors: r.errors,
            parser_errors: r.parser_errors,
            first_5_email_subjects_seen: r.first_5_email_subjects_seen,
            diagnostic_searches: r.diagnostic_searches,
            traces: r.traces,
            error: r.fatal,
          });
        }
        return Response.json({ ok: true, dryRun, results });
      },
    },
  },
});
