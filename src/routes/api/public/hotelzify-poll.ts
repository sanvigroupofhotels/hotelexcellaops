/**
 * Hotelzify Gmail polling endpoint.
 *
 * URL: /api/public/hotelzify-poll  (called by pg_cron every 5 minutes)
 *
 * Behavior:
 *   - Default Gmail query: `from:<sender> newer_than:30d` (no is:unread, no subject filter).
 *   - Optional config.subject_filters: applied AFTER fetching; counted as "matched".
 *   - Optional config.search_query: overrides the Gmail query entirely (debug).
 *   - Dedupe via external_bookings (integration_id, external_ref) — emails are NOT marked read,
 *     so re-runs are safe.
 */
import { createFileRoute } from "@tanstack/react-router";

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

type HeaderSample = {
  id?: string;
  date: string;
  from: string;
  subject: string;
};

type DiagnosticSearch = {
  query: string;
  count: number;
  resultSizeEstimate: number;
  samples: HeaderSample[];
  error?: string;
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
  text = text.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|tr|li|h\d)>/gi, "\n");
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
  return new RegExp(`(?:${alt})\\s*[:\\-]?\\s*([^\\n]+?)(?=\\n|$)`, "i");
}

function pickByLabels(text: string, labels: string[]): string | null {
  const re = labelRegex(labels);
  return re ? pick(text, re) : null;
}

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
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function parseMoney(input: string | null): number {
  if (!input) return 0;
  const cleaned = input.replace(/[^0-9.]/g, "");
  return cleaned ? parseFloat(cleaned) : 0;
}

const DEFAULT_LABELS: Record<string, string[]> = {
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

function parseHotelzifyEmail(
  text: string,
  subject: string,
  fieldLabels: Record<string, string[]>,
): { booking: ParsedBooking | null; errors: string[] } {
  const lbl = (k: string) => (fieldLabels[k]?.length ? fieldLabels[k] : DEFAULT_LABELS[k]);

  const bookingId =
    pickByLabels(text, lbl("booking_id")) ??
    pick(subject, /Booking[^A-Z0-9]*([A-Z0-9-]*\d[A-Z0-9-]*)/i);
  const name = pickByLabels(text, lbl("guest_name"));
  const mobile = pickByLabels(text, lbl("mobile"));
  const emailVal = pickByLabels(text, lbl("email"));
  const checkInRaw = pickByLabels(text, lbl("check_in"));
  const checkOutRaw = pickByLabels(text, lbl("check_out"));
  const checkIn = normalizeDate(checkInRaw);
  const checkOut = normalizeDate(checkOutRaw);
  const guestCount = pickByLabels(text, lbl("guests"));
  const paymentMode = pick(text, /Payment\s*Mode\s*[:\-]\s*([^\n]+?)(?=\n|$)/i);
  const bookingStatus =
    pickByLabels(text, lbl("booking_status")) ??
    (subject.toLowerCase().includes("confirmed") ? "Confirmed" : "Pending Confirmation");
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

  return {
    booking: {
      external_ref: bookingId,
      guest_name: name.replace(/\s*\([^)]*\)\s*$/, "").trim(),
      phone: mobile ? mobile.replace(/[\s\-()]/g, "") : null,
      email: emailMatch ? emailMatch[0].toLowerCase() : null,
      check_in: checkIn,
      check_out: checkOut,
      guests: guestCount ? parseInt(guestCount, 10) || 1 : 1,
      room_details: roomDetails,
      total_amount: parseMoney(totalAmount),
      amount_paid: parseMoney(amountPaid),
      payment_mode: paymentMode?.trim() ?? null,
      booking_status: bookingStatus.trim(),
      special_requests: specialReq && !/^none$/i.test(specialReq) ? specialReq.trim() : null,
    },
    errors: [],
  };
}

function mapStatus(hotelzifyStatus: string): string {
  const s = hotelzifyStatus.toLowerCase();
  if (s.includes("cancel")) return "Cancelled";
  if (s.includes("confirm")) return "Confirmed";
  return "Pending";
}

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
  const profile = await gmailFetch("/users/me/profile", gatewayKey, connectionKey);
  return profile.emailAddress ?? null;
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

export const Route = createFileRoute("/api/public/hotelzify-poll")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const gatewayKey = process.env.LOVABLE_API_KEY;
        const connectionKey = process.env.GOOGLE_MAIL_API_KEY;
        if (!gatewayKey || !connectionKey) {
          return Response.json({ ok: false, error: "Gmail connector not configured" }, { status: 500 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const url = new URL(request.url);
        const debug = url.searchParams.get("debug") === "1";

        const { data: intg, error: intgErr } = await supabaseAdmin
          .from("integrations")
          .select("*")
          .eq("provider", "hotelzify")
          .in("status", ["connected", "draft"])
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (intgErr || !intg) {
          return Response.json({ ok: false, error: "No Hotelzify integration" }, { status: 404 });
        }

        const cfg = (intg.config ?? {}) as any;
        const sender = cfg.sender_email ?? "support@hotelzify.com";
        const subjectFilters: string[] = Array.isArray(cfg.subject_filters) ? cfg.subject_filters : [];
        const days = cfg.lookback_days ?? 30;
        const customQuery: string | undefined = cfg.search_query;
        const gmailQuery = customQuery ?? `from:${sender} newer_than:${days}d`;

        const runStart = new Date().toISOString();
        let scanned = 0;
        let matched = 0;
        let parsedCount = 0;
        let created = 0;
        let updated = 0;
        const errors: string[] = [];
        const parserErrors: string[] = [];
        const headerSamples: HeaderSample[] = [];
        const diagnosticSearches: DiagnosticSearch[] = [];
        let accountEmail: string | null = null;

        try {
          accountEmail = await getGmailProfile(gatewayKey, connectionKey);
          const q = encodeURIComponent(gmailQuery);
          const list = await gmailFetch(`/users/me/messages?maxResults=50&q=${q}`, gatewayKey, connectionKey);
          const messages: { id: string }[] = list.messages ?? [];
          scanned = messages.length;

          if (messages.length === 0) {
            const diagnosticQueries = Array.from(new Set([
              gmailQuery,
              `in:anywhere from:${sender} newer_than:${days}d`,
              `in:anywhere ${sender} newer_than:365d`,
              `in:anywhere hotelzify newer_than:365d`,
              `in:anywhere "Your Booking with Hotel Excella" newer_than:365d`,
              `newer_than:30d`,
            ]));
            for (const query of diagnosticQueries) {
              diagnosticSearches.push(await runDiagnosticSearch(query, gatewayKey, connectionKey));
            }
          }

          for (const m of messages) {
            try {
              const msg = await gmailFetch(`/users/me/messages/${m.id}?format=full`, gatewayKey, connectionKey);
              const headers = headersMap(msg);
              const subject = headers.subject ?? "";
              const from = headers.from ?? "";
              if (headerSamples.length < 5) headerSamples.push({ id: m.id, date: headers.date ?? "", from, subject });

              if (subjectFilters.length > 0) {
                const subjLc = subject.toLowerCase();
                const hit = subjectFilters.some((f) => subjLc.includes(f.toLowerCase()));
                if (!hit) continue;
              }
              matched++;

              const text = extractTextFromPayload(msg.payload);
              const parsedResult = parseHotelzifyEmail(text, subject);
              if (!parsedResult.booking) {
                const reason = parsedResult.errors.join("; ") || "parse failed";
                parserErrors.push(`msg ${m.id} ("${subject.slice(0, 60)}"): ${reason}`);
                errors.push(`msg ${m.id}: ${reason}`);
                continue;
              }
              const parsed = parsedResult.booking;
              parsedCount++;

              let customerId: string | null = null;
              if (parsed.phone) {
                const { data: cust } = await supabaseAdmin
                  .from("customers").select("id").eq("phone", parsed.phone).limit(1).maybeSingle();
                if (cust) customerId = cust.id;
              }

              const { data: anyUser } = await supabaseAdmin
                .from("user_roles").select("user_id").eq("role", "admin").limit(1).maybeSingle();
              const systemUserId = anyUser?.user_id;
              if (!systemUserId) throw new Error("No admin user to attribute booking");

              if (!customerId) {
                const { data: newCust, error: custErr } = await supabaseAdmin
                  .from("customers")
                  .insert({
                    user_id: systemUserId,
                    guest_name: parsed.guest_name,
                    phone: parsed.phone,
                    email: parsed.email,
                    lead_source: "Hotelzify",
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
                lead_source: "Hotelzify",
                integration_id: intg.id,
                external_ref: parsed.external_ref,
                special_requests: parsed.special_requests,
                notes: `Imported from Hotelzify · Booking #${parsed.external_ref}`,
              };

              if (existing) {
                await supabaseAdmin.from("bookings").update({
                  guest_name: bookingPayload.guest_name,
                  phone: bookingPayload.phone,
                  email: bookingPayload.email,
                  check_in: bookingPayload.check_in,
                  check_out: bookingPayload.check_out,
                  guests: bookingPayload.guests,
                  room_details: bookingPayload.room_details,
                  amount: bookingPayload.amount,
                  status: bookingPayload.status,
                  special_requests: bookingPayload.special_requests,
                } as any).eq("id", existing.id);
                updated++;
              } else {
                await supabaseAdmin.from("bookings").insert(bookingPayload as any);
                created++;
              }

              await supabaseAdmin.from("external_bookings").upsert({
                integration_id: intg.id,
                external_ref: parsed.external_ref,
                raw_payload: { subject, parsed, gmail_message_id: m.id },
                state: "processed",
              } as any, { onConflict: "integration_id,external_ref" });
            } catch (e: any) {
              errors.push(`msg ${m.id}: ${e.message?.slice(0, 200)}`);
            }
          }

          await supabaseAdmin.from("integrations").update({
            status: "connected",
            last_sync_at: new Date().toISOString(),
            last_sync_status: errors.length === 0 ? "success" : "partial",
            last_sync_message: `Scanned ${scanned} · matched ${matched} · parsed ${parsedCount} · created ${created} · updated ${updated}${errors.length ? ` · ${errors.length} err` : ""}`,
            bookings_imported: (intg.bookings_imported ?? 0) + created,
          } as any).eq("id", intg.id);

          const summary = `query="${gmailQuery}" · scanned ${scanned} · matched ${matched} · parsed ${parsedCount} · created ${created} · updated ${updated}${errors.length ? ` · ${errors.length} errors` : ""}`;
          const excerpt = [
            `Gmail account: ${accountEmail ?? "unknown"}`,
            `Query: ${gmailQuery}`,
            `Emails Scanned: ${scanned}`,
            `Emails Matched: ${matched}`,
            `Emails Parsed: ${parsedCount}`,
            `Bookings Created: ${created}`,
            `Bookings Updated: ${updated}`,
            `First 5 email subjects/senders seen:\n${headerSamples.map((s) => `- From: ${s.from || "—"} | Subject: ${s.subject || "—"}`).join("\n") || "(none)"}`,
            parserErrors.length ? `Parser errors:\n${parserErrors.slice(0, 8).join("\n")}` : "",
            errors.length ? `Errors:\n${errors.slice(0, 8).join("\n")}` : "",
            diagnosticSearches.length ? `Diagnostic Gmail searches:\n${diagnosticSearches.map((d) => `- ${d.query}: ${d.error ? `ERROR ${d.error}` : `${d.count} returned, estimate ${d.resultSizeEstimate}`}${d.samples.length ? `\n  ${d.samples.map((s) => `From: ${s.from || "—"} | Subject: ${s.subject || "—"}`).join("\n  ")}` : ""}`).join("\n")}` : "",
          ].filter(Boolean).join("\n").slice(0, 5000);

          await supabaseAdmin.from("integration_runs").insert({
            integration_id: intg.id,
            started_at: runStart,
            finished_at: new Date().toISOString(),
            status: errors.length === 0 ? "success" : created + updated > 0 ? "partial" : "error",
            message: summary,
            created_count: created,
            updated_count: updated,
            payload_excerpt: excerpt,
          } as any);

          return Response.json({
            ok: true,
            gmail_account: accountEmail,
            query: gmailQuery,
            scanned, matched, parsed: parsedCount, created, updated,
            errors,
            parser_errors: parserErrors,
            first_5_email_subjects_seen: headerSamples,
            diagnostic_searches: debug || scanned === 0 ? diagnosticSearches : undefined,
          });
        } catch (e: any) {
          await supabaseAdmin.from("integration_runs").insert({
            integration_id: intg.id,
            started_at: runStart,
            finished_at: new Date().toISOString(),
            status: "error",
            message: `query="${gmailQuery}" · ${e.message?.slice(0, 300)}`,
            created_count: created,
            updated_count: updated,
            payload_excerpt: `Query: ${gmailQuery}\n${e.message?.slice(0, 500) ?? ""}`,
          } as any);
          await supabaseAdmin.from("integrations").update({
            last_sync_at: new Date().toISOString(),
            last_sync_status: "error",
            last_sync_message: e.message?.slice(0, 300),
          } as any).eq("id", intg.id);
          return Response.json({ ok: false, error: e.message, query: gmailQuery }, { status: 500 });
        }
      },
    },
  },
});
