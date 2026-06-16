/**
 * Hotelzify Gmail polling endpoint.
 *
 * URL: /api/public/hotelzify-poll  (called by pg_cron every 5 minutes)
 *
 * Flow:
 *   1. Load active 'hotelzify' integration row
 *   2. Search Gmail (via connector gateway) for new mails from support@hotelzify.com
 *   3. Parse each message → upsert into bookings + external_bookings (dedupe via booking_id)
 *   4. Mark messages as read so they aren't re-imported
 *   5. Record an integration_runs row
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
      if (p.mimeType === "text/plain") parts.push(decoded);
      else if (p.mimeType === "text/html") parts.push(decoded);
    }
    if (Array.isArray(p.parts)) p.parts.forEach(walk);
  };
  walk(payload);
  let text = parts.join("\n");
  // strip HTML if present
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

function parseHotelzifyEmail(text: string, subject: string): ParsedBooking | null {
  const bookingId = pick(text, /Booking\s*Id[:\s]*([0-9]+)/i);
  if (!bookingId) return null;

  const name = pick(text, /Name[:\s]*([^\n]+?)(?=\s*Mobile|\n)/i) ?? "";
  const mobile = pick(text, /Mobile[:\s]*([+\d\s\-()]+)/i);
  const email = pick(text, /Email[:\s]*([\w.+-]+@[\w.-]+)/i);
  const checkIn = pick(text, /Check[-\s]*in[:\s]*([0-9]{4}-[0-9]{2}-[0-9]{2})/i);
  const checkOut = pick(text, /Check[-\s]*out[:\s]*([0-9]{4}-[0-9]{2}-[0-9]{2})/i);
  const guestCount = pick(text, /Guest\s*Count[:\s]*([0-9]+)/i);
  const paymentMode = pick(text, /Payment\s*Mode[:\s]*([^\n]+?)(?=\n|$)/i);
  const bookingStatus = pick(text, /Booking\s*Status[:\s]*([^\n]+?)(?=\n|Guest|Room|$)/i) ?? (subject.toLowerCase().includes("confirmed") ? "Confirmed" : "Pending Confirmation");
  const totalAmount = pick(text, /Total\s*Amount[^:]*:\s*INR\s*([\d,]+(?:\.\d+)?)/i);
  const amountPaid = pick(text, /Amount\s*Paid[^:]*:\s*INR\s*([\d,]+(?:\.\d+)?)/i);
  const specialReq = pick(text, /Guest\s*Requests\s*\n?([^\n]+)/i);

  // Try to find a room name from the table row before "Adults:" or "INR"
  let roomDetails = "";
  const roomMatch = text.match(/Room\s*Name\s+Quantity\s+Total\s*Price\s*\n?\s*([^\n]+?)\s+(?:Adults?|Rooms?)/i);
  if (roomMatch) roomDetails = roomMatch[1].trim();

  if (!checkIn || !checkOut || !name) return null;

  return {
    external_ref: bookingId,
    guest_name: name.replace(/\s*\([^)]*\)\s*$/, "").trim(),
    phone: mobile ? mobile.replace(/[\s\-()]/g, "") : null,
    email: email?.toLowerCase() ?? null,
    check_in: checkIn,
    check_out: checkOut,
    guests: guestCount ? parseInt(guestCount, 10) : 1,
    room_details: roomDetails,
    total_amount: totalAmount ? parseFloat(totalAmount.replace(/,/g, "")) : 0,
    amount_paid: amountPaid ? parseFloat(amountPaid.replace(/,/g, "")) : 0,
    payment_mode: paymentMode?.trim() ?? null,
    booking_status: bookingStatus.trim(),
    special_requests: specialReq && !/^none$/i.test(specialReq) ? specialReq.trim() : null,
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

export const Route = createFileRoute("/api/public/hotelzify-poll")({
  server: {
    handlers: {
      POST: async () => {
        const gatewayKey = process.env.LOVABLE_API_KEY;
        const connectionKey = process.env.GOOGLE_MAIL_API_KEY;
        if (!gatewayKey || !connectionKey) {
          return Response.json({ ok: false, error: "Gmail connector not configured" }, { status: 500 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // 1. Get active Hotelzify integration
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

        const runStart = new Date().toISOString();
        let created = 0;
        let updated = 0;
        let scanned = 0;
        const errors: string[] = [];

        try {
          // 2. Search unread mail from sender (last 7 days, max 25 per run)
          const query = encodeURIComponent(`from:${sender} is:unread newer_than:7d`);
          const list = await gmailFetch(`/users/me/messages?maxResults=25&q=${query}`, gatewayKey, connectionKey);
          const messages: { id: string }[] = list.messages ?? [];
          scanned = messages.length;

          for (const m of messages) {
            try {
              const msg = await gmailFetch(`/users/me/messages/${m.id}?format=full`, gatewayKey, connectionKey);
              const headers: { name: string; value: string }[] = msg.payload?.headers ?? [];
              const subject = headers.find((h) => h.name.toLowerCase() === "subject")?.value ?? "";
              const text = extractTextFromPayload(msg.payload);
              const parsed = parseHotelzifyEmail(text, subject);
              if (!parsed) {
                errors.push(`msg ${m.id}: parse failed`);
                continue;
              }

              // Find or create customer
              let customerId: string | null = null;
              if (parsed.phone) {
                const { data: cust } = await supabaseAdmin
                  .from("customers")
                  .select("id, user_id")
                  .eq("phone", parsed.phone)
                  .limit(1)
                  .maybeSingle();
                if (cust) customerId = cust.id;
              }

              // Resolve a user_id (system user — first admin)
              const { data: anyUser } = await supabaseAdmin
                .from("user_roles")
                .select("user_id")
                .eq("role", "admin")
                .limit(1)
                .maybeSingle();
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
                  .select("id")
                  .single();
                if (custErr) throw custErr;
                customerId = newCust!.id;
              }

              // Upsert booking by (integration_id, external_ref)
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
                await supabaseAdmin
                  .from("bookings")
                  .update({
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
                  } as any)
                  .eq("id", existing.id);
                updated++;
              } else {
                await supabaseAdmin.from("bookings").insert(bookingPayload as any);
                created++;
              }

              // Track in external_bookings (raw payload)
              await supabaseAdmin
                .from("external_bookings")
                .upsert(
                  {
                    integration_id: intg.id,
                    external_ref: parsed.external_ref,
                    raw_payload: { subject, parsed, gmail_message_id: m.id },
                    state: "processed",
                  } as any,
                  { onConflict: "integration_id,external_ref" },
                );

              // Mark message as read
              await gmailFetch(`/users/me/messages/${m.id}/modify`, gatewayKey, connectionKey, {
                method: "POST",
                body: JSON.stringify({ removeLabelIds: ["UNREAD"] }),
              });
            } catch (e: any) {
              errors.push(`msg ${m.id}: ${e.message}`);
            }
          }

          // 3. Update integration row
          await supabaseAdmin
            .from("integrations")
            .update({
              status: "connected",
              last_sync_at: new Date().toISOString(),
              last_sync_status: errors.length === 0 ? "success" : "partial",
              last_sync_message: `Scanned ${scanned}, created ${created}, updated ${updated}${errors.length ? `, ${errors.length} errors` : ""}`,
              bookings_imported: (intg.bookings_imported ?? 0) + created,
            } as any)
            .eq("id", intg.id);

          // 4. Record run
          await supabaseAdmin.from("integration_runs").insert({
            integration_id: intg.id,
            started_at: runStart,
            finished_at: new Date().toISOString(),
            status: errors.length === 0 ? "success" : created + updated > 0 ? "partial" : "error",
            message: errors.slice(0, 5).join(" | ") || `Scanned ${scanned}`,
            created_count: created,
            updated_count: updated,
            payload_excerpt: errors.length ? errors.slice(0, 3).join("\n").slice(0, 500) : null,
          } as any);

          return Response.json({ ok: true, scanned, created, updated, errors });
        } catch (e: any) {
          await supabaseAdmin.from("integration_runs").insert({
            integration_id: intg.id,
            started_at: runStart,
            finished_at: new Date().toISOString(),
            status: "error",
            message: e.message?.slice(0, 500) ?? "Unknown error",
            created_count: created,
            updated_count: updated,
          } as any);
          await supabaseAdmin
            .from("integrations")
            .update({
              last_sync_at: new Date().toISOString(),
              last_sync_status: "error",
              last_sync_message: e.message?.slice(0, 300),
            } as any)
            .eq("id", intg.id);
          return Response.json({ ok: false, error: e.message }, { status: 500 });
        }
      },
    },
  },
});
