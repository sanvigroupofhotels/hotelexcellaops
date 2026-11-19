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
import { isOtaSystemEmail, normalizeExternalRef } from "@/lib/ota-domains";
import { buildOtaImport, otaCategoryMapSchema } from "@/lib/ota-import-rules";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";
import { createClient } from "@supabase/supabase-js";

import { PARSERS, parseGeneric, HOTELZIFY_DEFAULTS, isReceptionPhone, type ParsedBooking } from "@/lib/ota-email-parser";

const GMAIL_BASE = "https://connector-gateway.lovable.dev/google_mail/gmail/v1";

type HeaderSample = { id?: string; date: string; from: string; subject: string };
type DiagnosticSearch = { query: string; count: number; resultSizeEstimate: number; samples: HeaderSample[]; error?: string };
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
  if (parsed.email && !isOtaSystemEmail(parsed.email) && (!currentEmail || blocked.has(currentEmail) || isOtaSystemEmail(currentEmail))) patch.email = parsed.email;
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
  const parser = PARSERS[provider] ?? ((text, subject, fl, opts) => parseGeneric(text, subject, HOTELZIFY_DEFAULTS, fl, { statusFromSubject: true, ...opts }));

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
  // Configurable tax rate (decimal, e.g. 0.05 for 5%). Default 5% — Hotelzify
  // line items historically show "Tax (5%)" but the value itself is often
  // missing or polluted. Used as fallback and as a sanity clamp.
  const configuredTaxRate: number = (() => {
    const raw = cfg.tax_rate;
    if (typeof raw === "number" && raw >= 0 && raw <= 100) return raw > 1 ? raw / 100 : raw;
    if (typeof raw === "string" && raw.trim()) {
      const n = parseFloat(raw);
      if (Number.isFinite(n)) return n > 1 ? n / 100 : n;
    }
    return 0.05;
  })();

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
    // Recover upcoming orphan imports even if their emails are outside the lookback.
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const { data: orphans, error: orphanError } = await supabaseAdmin.from("external_bookings")
      .select("raw_payload,parsed,booking_id").eq("integration_id", intg.id);
    if (orphanError) throw orphanError;
    const recoveryIds = new Set<string>();
    for (const orphan of orphans ?? []) {
      const saved = orphan.parsed as any;
      const id = (orphan.raw_payload as any)?.gmail_message_id;
      if (typeof id !== "string" || !saved?.check_out || saved.check_out < today || /cancel|no.show/i.test(saved.booking_status ?? "")) continue;
      // Apply corrected inclusive-total semantics once to active old imports.
      if (orphan.booking_id && (orphan.raw_payload as any)?.import_rules_version === 2) continue;
      recoveryIds.add(id);
      if (!messages.some((message) => message.id === id)) messages.push({ id });
    }
    result.scanned = messages.length;

    if (messages.length === 0 && debug && sender) {
      result.diagnostic_searches = [];
      for (const q of [
        gmailQuery,
        `in:anywhere from:${sender} newer_than:${days}d`,
        `in:anywhere ${sender} newer_than:365d`,
      ]) result.diagnostic_searches.push(await runDiagnosticSearch(q, gatewayKey, connectionKey));
    }

    // Idempotency ledger: Gmail message IDs already processed are skipped instantly.
    const forceReprocess = cfg.force_reprocess === true;
    let processedIds = new Set<string>();
    if (!forceReprocess && messages.length > 0) {
      const { data: done } = await supabaseAdmin
        .from("integration_processed_messages" as any)
        .select("message_id")
        .eq("integration_id", intg.id)
        .in("message_id", messages.map((x: any) => x.id));
      processedIds = new Set(((done ?? []) as any[]).map((d) => d.message_id));
    }
    const markProcessed = async (messageId: string, outcome: string, ref?: string | null) => {
      if (dryRun) return;
      await supabaseAdmin.from("integration_processed_messages" as any).upsert(
        { integration_id: intg.id, message_id: messageId, outcome, external_ref: ref ?? null } as any,
        { onConflict: "integration_id,message_id" },
      );
    };

    for (const m of messages) {
      if (processedIds.has(m.id) && !recoveryIds.has(m.id)) { (result as any).skipped_already_processed = ((result as any).skipped_already_processed ?? 0) + 1; continue; }
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
          await markProcessed(m.id, "unparsed");
          continue;
        }
        const parsed = parseRes.booking;
        parsed.external_ref = normalizeExternalRef(parsed.external_ref) || parsed.external_ref;
        if (parsed.email && isOtaSystemEmail(parsed.email)) parsed.email = null as any;
        result.parsed++;

        const { data: existing } = await supabaseAdmin
          .from("bookings")
          .select("id, phone, email, customer_id, advance_paid, status")
          .eq("external_ref", parsed.external_ref)
          .order("created_at", { ascending: true })
          .limit(1)
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
            if (!newCust) throw new Error("Customer creation failed");
            customerId = newCust.id;
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

        const plan = buildOtaImport(parsed, configuredTaxRate, cfg.room_category_mappings == null ? undefined : otaCategoryMapSchema.parse(cfg.room_category_mappings));
        const totalPayable = plan.pricing.total;
        const roomChargesBase = plan.pricing.subtotal;
        const taxAmount = plan.pricing.taxes;
        const effectiveTaxRate = plan.pricing.taxRate;
        const discountAmount = 0; // Email total is authoritative, already after OTA discounts.

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
          taxes: taxAmount,
          tax_rate: effectiveTaxRate,
          taxes_included: true,
          total_override: totalPayable,
          advance_paid: existing?.advance_paid ?? 0,
          status: mapStatus(parsed.booking_status),
          lead_source: leadSource,
          integration_id: intg.id,
          external_ref: parsed.external_ref,
          special_requests: parsed.special_requests,
          notes: `Imported from ${leadSource} · Booking #${parsed.external_ref}${parsed.payment_mode ? ` · ${parsed.payment_mode}` : ""}`,
        };
        const syntheticItems = plan.items;
        const trace: ImportTrace = {
          external_ref: parsed.external_ref,
          gmail_message_id: m.id,
          subject,
          action: existing ? (allowUpdates ? "update" : "skip") : "create",
          parsed_payload: maskedParsedPayload(parsed),
          database_payload: maskedDatabasePayload({ ...bookingPayload, _booking_items: syntheticItems }),
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
            // Follow-up OTA emails (e.g. FabHotels payment update) may only RAISE the
            // advance collected; staff-owned fields are never touched.
            const incomingAdv = Number(bookingPayload.advance_paid ?? 0);
            const currentAdv = Number((existing as any).advance_paid ?? 0);
            if (incomingAdv > currentAdv) (contactRepairPayload as any).advance_paid = incomingAdv;
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
              // Check whether staff have edited line items on this booking.
              // If the booking has anything other than a single synthetic row
              // (multi-room, breakfast/pet/extra-bed/late-checkout charges,
              // custom rates), preserve them and skip the line-item refresh.
              const { data: existingItems, error: existingItemsError } = await supabaseAdmin
                .from("booking_items")
                .select("id, position, room_type, rooms, adults, children, breakfast_included, extra_bed, extra_adults, drivers, early_check_in, late_check_out, pet_size, notes, assigned_room_id, item_status, checked_in_at, checked_out_at")
                .eq("booking_id", existing.id);
              if (existingItemsError) throw existingItemsError;
              const items = existingItems ?? [];
              const looksSynthetic =
                items.length === 1 &&
                (items[0].rooms ?? 1) === 1 &&
                !items[0].breakfast_included &&
                (items[0].extra_bed ?? 0) === 0 &&
                (items[0].extra_adults ?? 0) === 0 &&
                (items[0].drivers ?? 0) === 0 &&
                !items[0].early_check_in &&
                !items[0].late_check_out &&
                ((items[0].pet_size ?? "none") === "none");
              const { data: assignments, error: assignmentError } = await supabaseAdmin.from("booking_room_assignments").select("id").eq("booking_id", existing.id).limit(1);
              if (assignmentError) throw assignmentError;
              const staffEdited = !looksSynthetic || items.some((item: { assigned_room_id: string | null; checked_in_at: string | null; checked_out_at: string | null; item_status: string | null }) => item.assigned_room_id || item.checked_in_at || item.checked_out_at || !["Pending", "Confirmed"].includes(item.item_status ?? "Confirmed")) || (assignments ?? []).length > 0 || ["Checked-In", "Checked-Out", "Stay Completed", "Cancelled", "No-Show"].includes(existing.status);

              // Patch financial + status fields. Never overwrite guest identity,
              // phone, room assignment, or staff notes — those are owned by the PMS once created.
              // If staff have customized line items, preserve their `total_override`
              // as well so a manual amount override isn't silently wiped.
              const { data: currentBooking } = staffEdited
                ? await supabaseAdmin.from("bookings").select("total_override").eq("id", existing.id).single()
                : { data: null as { total_override: number | null } | null };
              const { error: updateBookingError } = await supabaseAdmin.from("bookings").update({
                amount: bookingPayload.amount,
                subtotal: bookingPayload.subtotal,
                discount: bookingPayload.discount,
                taxes: bookingPayload.taxes,
                tax_rate: bookingPayload.tax_rate,
                taxes_included: bookingPayload.taxes_included,
                total_override: staffEdited && currentBooking?.total_override != null
                  ? currentBooking.total_override
                  : bookingPayload.total_override,
                advance_paid: Math.max(Number(bookingPayload.advance_paid ?? 0), Number((existing as any).advance_paid ?? 0)),
                status: ["Checked-In", "Checked-Out", "Stay Completed", "No-Show", "Cancelled"].includes(String((existing as any).status))
                  ? (existing as any).status
                  : bookingPayload.status,
                special_requests: bookingPayload.special_requests,
                ...contactPatchFromParsed(existing, parsed, blockedEmails),
              } as any).eq("id", existing.id);
              if (updateBookingError) throw updateBookingError;
              // Only refresh the synthetic line item when staff haven't customized it.
              if (!staffEdited) {
                const { error: itemErr } = await supabaseAdmin.rpc("refresh_unassigned_ota_items", {
                  p_booking_id: existing.id, p_items: syntheticItems as any,
                });
                if (itemErr) throw itemErr;
              }
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
            await supabaseAdmin.from("booking_activities").insert({
              booking_id: insertedBooking.id,
              actor_name: `System (${leadSource} Sync)`,
              actor_role: "system",
              action: "booking_created",
              to_status: bookingPayload.status,
              notes: `Imported via ${leadSource} · Booking #${parsed.external_ref}`,
              metadata: { source: "ota_import", integration_id: intg.id, gmail_message_id: m.id },
            } as any);
            await supabaseAdmin.from("notifications").insert({
              type: "booking_created",
              title: `New Booking · ${leadSource} (#${parsed.external_ref})`,
              body: [`Guest: ${(bookingPayload as any).guest_name ?? "—"}`, `Phone: ${(bookingPayload as any).phone ?? "—"}`,
                `Check-In: ${(bookingPayload as any).check_in ?? "—"}`, `Check-Out: ${(bookingPayload as any).check_out ?? "—"}`,
                (bookingPayload as any).amount ? `Value: ₹${(bookingPayload as any).amount}` : null, `Source: ${leadSource}`].filter(Boolean).join("\n"),
              entity_type: "booking", entity_id: insertedBooking.id, entity_reference: parsed.external_ref,
              priority: "normal", audience_role: "operations", status: "unread",
              metadata: { booking_id: insertedBooking.id, source: leadSource, integration_id: intg.id },
            } as any).then(({ error }: any) => { if (error) console.warn("[ota notify]", error.message); });
            // Insert synthetic line item so the Pricing Summary shows Room Charges,
            // Subtotal, Discount, Taxable Amount, and Tax derived from one consistent base.
            const { error: itemErr } = await supabaseAdmin
              .from("booking_items")
              .insert(syntheticItems.map((item) => ({ booking_id: insertedBooking.id, ...item })) as any);
            if (itemErr) {
              throw itemErr;
            }
          }
          result.created++;
        }

        if (!dryRun) {
          if (bookingIdForExternal && plan.advance > 0 && !["Cancelled", "No-Show", "Checked-Out", "Stay Completed"].includes(existing?.status ?? "")) {
            const { error: paymentError } = await supabaseAdmin.rpc("record_ota_prepaid" as any, {
              p_booking_id: bookingIdForExternal, p_total: totalPayable, p_provider: leadSource, p_external_ref: parsed.external_ref,
            } as any);
            if (paymentError) throw paymentError;
          }
          const { error: externalError } = await supabaseAdmin.from("external_bookings").upsert({
            integration_id: intg.id,
            external_ref: parsed.external_ref,
            raw_payload: { subject, parsed, gmail_message_id: m.id, trace, import_rules_version: 2 },
            parsed,
            booking_id: bookingIdForExternal,
            state: "processed",
          } as any, { onConflict: "integration_id,external_ref" });
          if (externalError) throw externalError;
          if (existing && bookingIdForExternal && Object.keys(contactRepairPayload).length > 0) {
            await supabaseAdmin.from("booking_activities").insert({
              booking_id: bookingIdForExternal,
              actor_name: `System (${leadSource} Sync)`,
              actor_role: "system",
              action: "booking_updated",
              notes: `Follow-up email from ${leadSource} applied`,
              metadata: { source: "ota_import", changes: contactRepairPayload, gmail_message_id: m.id },
            } as any);
            const adv = (contactRepairPayload as any).advance_paid;
            if (adv != null) {
              await supabaseAdmin.from("notifications").insert({
                type: "payment_received",
                title: `Payment Updated · ${leadSource} (#${parsed.external_ref})`,
                body: `Advance paid updated to ₹${adv} via ${leadSource} follow-up email.`,
                entity_type: "booking", entity_id: bookingIdForExternal, entity_reference: parsed.external_ref,
                priority: "normal", audience_role: "operations", status: "unread",
                metadata: { booking_id: bookingIdForExternal, source: leadSource, advance_paid: adv },
              } as any).then(({ error }: any) => { if (error) console.warn("[ota notify]", error.message); });
            }
          }
        }
        await markProcessed(m.id, existing ? "updated" : "created", parsed.external_ref);
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
        const cronDenied = await authenticateCronRequest(request);
        if (cronDenied) {
          const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
          const publicKey = process.env.SUPABASE_PUBLISHABLE_KEY;
          const dbUrl = process.env.SUPABASE_URL;
          if (!token || !publicKey || !dbUrl) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
          const caller = createClient(dbUrl, publicKey, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } });
          const { data: claims, error: claimsError } = await caller.auth.getClaims(token);
          if (claimsError || !claims?.claims?.sub) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
          {
            const { data: isAdmin, error } = await caller.rpc("has_role", { _user_id: claims.claims.sub, _role: "admin" });
            const { data: isOwner } = await caller.rpc("has_role", { _user_id: claims.claims.sub, _role: "owner" });
            if (error || (!isAdmin && !isOwner)) return Response.json({ ok: false, error: "Forbidden" }, { status: 403 });
          }
        }
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
          .in("status", dryRun ? ["connected", "draft", "disabled"] : ["connected", "draft"]);
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
