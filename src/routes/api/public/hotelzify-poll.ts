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
  total_amount: number;
  amount_paid: number;
  payment_mode: string | null;
  booking_status: string;
  special_requests: string | null;
};

type HeaderSample = { id?: string; date: string; from: string; subject: string };
type DiagnosticSearch = { query: string; count: number; resultSizeEstimate: number; samples: HeaderSample[]; error?: string };

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
  return new RegExp(`(?:${alt})\\s*[:|\\-]?\\s*([^\\n|]+?)(?=\\n|\\||$)`, "i");
}

function pickByLabels(text: string, labels: string[]): string | null {
  const re = labelRegex(labels);
  return re ? pick(text, re) : null;
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
  booking_id: ["Booking ID", "Booking Id", "Booking Reference", "Booking Ref", "Booking No", "Booking Number"],
  guest_name: ["Guest Name", "Name"],
  mobile: ["Mobile", "Phone", "Contact", "Mobile No", "Phone No"],
  email: ["Email"],
  check_in: ["Check In", "Check-In", "Check in", "Arrival", "Arrival Date"],
  check_out: ["Check Out", "Check-Out", "Check out", "Departure", "Departure Date"],
  guests: ["Guests", "Adults", "Guest Count"],
  room_details: ["Room Name", "Room Type", "Room Details", "Room"],
  total_amount: ["Total Amount", "Total Price", "Total"],
  amount_paid: ["Amount Paid", "Paid"],
  balance_due: ["Balance Due", "Balance"],
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
  opts?: { statusFromSubject?: boolean },
): { booking: ParsedBooking | null; errors: string[] } {
  const lbl = (k: string) => (fieldLabels[k]?.length ? fieldLabels[k] : defaults[k] ?? []);

  const bookingId =
    pickByLabels(text, lbl("booking_id")) ??
    pick(subject, /Booking\s*(?:ID|Id|No|Number|Reference)[^A-Z0-9]*([A-Z0-9-]*\d[A-Z0-9-]*)/i) ??
    pick(subject, /Booking[^A-Z0-9]*([A-Z0-9-]*\d[A-Z0-9-]*)/i);
  const name = pickByLabels(text, lbl("guest_name"));
  const mobile = pickByLabels(text, lbl("mobile"));
  const emailVal = pickByLabels(text, lbl("email"));
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
  const totalAmount = pickByLabels(text, lbl("total_amount"));
  const amountPaid = pickByLabels(text, lbl("amount_paid"));
  const specialReq = pickByLabels(text, lbl("special_requests"));
  const roomDetails = pickByLabels(text, lbl("room_details")) ?? "";

  const errors: string[] = [];
  if (!bookingId) errors.push("missing booking id");
  if (!name) errors.push("missing guest name");
  if (!checkIn) errors.push(`missing/invalid check-in${checkInRaw ? ` (${checkInRaw})` : ""}`);
  if (!checkOut) errors.push(`missing/invalid check-out${checkOutRaw ? ` (${checkOutRaw})` : ""}`);
  if (!bookingId || !name || !checkIn || !checkOut) return { booking: null, errors };

  const emailMatch = emailVal?.match(/[\w.+-]+@[\w.-]+\.\w+/);

  // Safeguard — never store the hotel's reception number as a guest phone.
  // Canonicalize to +91XXXXXXXXXX so OTA imports honour the same invariant as the rest of the PMS.
  const RECEPTION_NUMBERS = new Set(["9985908131", "09985908131", "+919985908131", "919985908131"]);
  const cleanedPhone = mobile ? mobile.replace(/[\s\-()]/g, "") : null;
  const isReception = cleanedPhone ? RECEPTION_NUMBERS.has(cleanedPhone) : false;
  let guestPhone: string | null = null;
  if (cleanedPhone && !isReception) {
    const n = normalizePhoneNumber(cleanedPhone);
    guestPhone = validatePhoneNumber(n) ? n : null;
  }

  return {
    booking: {
      external_ref: bookingId,
      guest_name: name.replace(/\s*\([^)]*\)\s*$/, "").trim(),
      phone: guestPhone,
      email: emailMatch ? emailMatch[0].toLowerCase() : null,
      check_in: checkIn,
      check_out: checkOut,
      guests: guestCount ? parseInt(guestCount, 10) || 1 : 1,
      room_details: roomDetails.trim(),
      total_amount: parseMoney(totalAmount),
      amount_paid: parseMoney(amountPaid),
      payment_mode: paymentMode?.trim() ?? null,
      booking_status: (bookingStatus ?? "Pending Confirmation").trim(),
      special_requests: specialReq && !/^none$/i.test(specialReq) ? specialReq.trim() : null,
    },
    errors: [],
  };
}

type ProviderParser = (text: string, subject: string, fieldLabels: Record<string, string[]>) => { booking: ParsedBooking | null; errors: string[] };

const PARSERS: Record<string, ProviderParser> = {
  hotelzify: (text, subject, fl) => parseGeneric(text, subject, HOTELZIFY_DEFAULTS, fl, { statusFromSubject: true }),
  fabhotels: (text, subject, fl) => parseGeneric(text, subject, FABHOTELS_DEFAULTS, fl, { statusFromSubject: true }),
};

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

function headersMap(msg: any): Record<string, string> {
  const headers: { name: string; value: string }[] = msg.payload?.headers ?? [];
  return Object.fromEntries(headers.map((h) => [h.name.toLowerCase(), h.value]));
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

    const list = await gmailFetch(`/users/me/messages?maxResults=50&q=${encodeURIComponent(gmailQuery)}`, gatewayKey, connectionKey);
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
        const msg = await gmailFetch(`/users/me/messages/${m.id}?format=full`, gatewayKey, connectionKey);
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
        const parseRes = parser(text, subject, fieldLabels);
        if (!parseRes.booking) {
          const reason = parseRes.errors.join("; ") || "parse failed";
          result.parser_errors.push(`msg ${m.id} ("${subject.slice(0, 60)}"): ${reason}`);
          continue;
        }
        const parsed = parseRes.booking;
        result.parsed++;

        let customerId: string | null = null;
        if (parsed.phone) {
          const { data: cust } = await supabaseAdmin
            .from("customers").select("id").eq("phone", parsed.phone).limit(1).maybeSingle();
          if (cust) customerId = cust.id;
        }

        const { data: anyUser } = await supabaseAdmin
          .from("user_roles").select("user_id").eq("role", "admin").limit(1).maybeSingle();
        const systemUserId = anyUser?.user_id;
        if (!systemUserId && !dryRun) throw new Error("No admin user to attribute booking");

        if (!customerId && !dryRun) {
          const { data: newCust, error: custErr } = await supabaseAdmin
            .from("customers")
            .insert({
              user_id: systemUserId,
              guest_name: parsed.guest_name,
              phone: parsed.phone,
              email: parsed.email,
              lead_source: leadSource,
            } as any)
            .select("id").single();
          if (custErr) throw custErr;
          customerId = newCust!.id;
        }

        const { data: existing } = await supabaseAdmin
          .from("bookings")
          .select("id")
          .eq("integration_id", intg.id)
          .eq("external_ref", parsed.external_ref)
          .maybeSingle();

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
          amount: parsed.total_amount,
          subtotal: parsed.total_amount,
          advance_paid: parsed.amount_paid,
          status: mapStatus(parsed.booking_status),
          lead_source: leadSource,
          integration_id: intg.id,
          external_ref: parsed.external_ref,
          special_requests: parsed.special_requests,
          notes: `Imported from ${leadSource} · Booking #${parsed.external_ref}`,
        };

        if (existing) {
          if (!allowUpdates) {
            // Dedupe-skip: existing booking, updates disabled in integration config.
            result.parser_errors.push(`msg ${m.id} ("${subject.slice(0, 60)}"): skipped — booking exists (updates disabled)`);
          } else {
            if (!dryRun) {
              // Patch only safe financial / status / requests fields. Never overwrite guest identity,
              // phone, room assignment, or staff notes — those are owned by the PMS once created.
              await supabaseAdmin.from("bookings").update({
                amount: bookingPayload.amount,
                subtotal: bookingPayload.amount,
                advance_paid: bookingPayload.advance_paid,
                status: bookingPayload.status,
                special_requests: bookingPayload.special_requests,
              } as any).eq("id", existing.id);
            }
            result.updated++;
          }
        } else {
          if (!dryRun) {
            await supabaseAdmin.from("bookings").insert(bookingPayload as any);
          }
          result.created++;
        }

        if (!dryRun) {
          await supabaseAdmin.from("external_bookings").upsert({
            integration_id: intg.id,
            external_ref: parsed.external_ref,
            raw_payload: { subject, parsed, gmail_message_id: m.id },
            state: "processed",
          } as any, { onConflict: "integration_id,external_ref" });
        }
      } catch (e: any) {
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
        if (!gatewayKey || !connectionKey) {
          return Response.json({
            ok: false,
            error: "Gmail is not connected yet. Email-parser integrations (FabHotels, Hotelzify, OYO, etc.) read confirmation emails from your reception Gmail inbox. Please connect Gmail under Settings → Connections, then run this sync again.",
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
            query: r.query,
            scanned: r.scanned, matched: r.matched, parsed: r.parsed,
            created: r.created, updated: r.updated,
            errors: r.errors,
            parser_errors: r.parser_errors,
            first_5_email_subjects_seen: r.first_5_email_subjects_seen,
            diagnostic_searches: r.diagnostic_searches,
            error: r.fatal,
          });
        }
        return Response.json({ ok: true, dryRun, results });
      },
    },
  },
});
