/**
 * Notification Email Dispatcher
 *
 * Fired by the `notifications_dispatch_email_trg` trigger after every new
 * row in `public.notifications`. Sends an email to the operator inbox(es)
 * configured in `app_settings.notification_email_recipients`.
 *
 * Delivery is via the Resend connector through the Lovable Gateway —
 * keeps the Resend API key in workspace connectors instead of code.
 *
 * Email is ADDITIVE — failures here NEVER block in-app or push delivery.
 */
import { createFileRoute } from "@tanstack/react-router";
import { resolveNotificationRoute } from "@/lib/notification-routing";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/resend";

// Default sender — uses Resend's onboarding sandbox so dispatch works
// before the user verifies a custom domain. Override via app_settings
// `notification_email_from` when ready.
const DEFAULT_FROM = "Hotel Excella <onboarding@resend.dev>";

export const Route = createFileRoute("/api/public/notification-email-dispatch")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const headerSecret = request.headers.get("x-dispatch-secret") ?? "";
          const expected = process.env.PUSH_DISPATCH_SECRET ?? "";
          if (!expected || headerSecret !== expected) {
            return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
              status: 401, headers: { "content-type": "application/json" },
            });
          }
          const body = await request.json().catch(() => ({}));
          const notification_id = body?.notification_id;
          if (!notification_id || typeof notification_id !== "string") {
            return Response.json({ ok: false, error: "missing notification_id" });
          }

          const lovableKey = process.env.LOVABLE_API_KEY;
          const resendKey = process.env.RESEND_API_KEY;
          if (!lovableKey || !resendKey) {
            return Response.json({ ok: false, error: "resend_not_configured", sent: 0 });
          }

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          const { data: n, error: nErr } = await supabaseAdmin
            .from("notifications" as any)
            .select("id,type,title,body,entity_type,entity_id,entity_reference,metadata,priority,created_at")
            .eq("id", notification_id)
            .maybeSingle();
          if (nErr || !n) return Response.json({ ok: false, error: nErr?.message ?? "not_found" });
          const notif: any = n;

          // Recipients
          const { data: recRow } = await supabaseAdmin
            .from("app_settings" as any)
            .select("value")
            .eq("key", "notification_email_recipients")
            .maybeSingle();
          let recipients: string[] = [];
          const v = (recRow as any)?.value;
          if (Array.isArray(v)) recipients = v.filter((s) => typeof s === "string" && s.includes("@"));
          else if (typeof v === "string" && v.includes("@")) recipients = [v];
          if (recipients.length === 0) {
            return Response.json({ ok: false, error: "no_recipients", sent: 0 });
          }

          // Optional sender override
          const { data: fromRow } = await supabaseAdmin
            .from("app_settings" as any)
            .select("value")
            .eq("key", "notification_email_from")
            .maybeSingle();
          let from = DEFAULT_FROM;
          const fv = (fromRow as any)?.value;
          if (typeof fv === "string" && fv.length > 4) from = fv;

          // Build link back to the app (best-effort).
          const path = resolveNotificationRoute({
            entity_type: notif.entity_type,
            entity_id: notif.entity_id,
            metadata: notif.metadata,
          });
          // Origin must be configured per-environment so emails link to the
          // correct deployment. Reuse push_dispatch_url's origin if set.
          const { data: pdu } = await supabaseAdmin
            .from("app_settings" as any).select("value").eq("key", "push_dispatch_url").maybeSingle();
          const dispatchUrl = String((pdu as any)?.value ?? "");
          const origin = dispatchUrl.replace(/\/api\/public\/.*$/, "") || "https://hotelexcellaops.lovable.app";
          const fullUrl = `${origin}${path}`;

          const html = renderEmail({
            title: notif.title,
            body: notif.body,
            url: fullUrl,
            reference: notif.entity_reference ?? null,
            type: notif.type,
            priority: notif.priority,
          });

          const subject = `[Hotel Excella] ${notif.title}${notif.entity_reference ? ` · ${notif.entity_reference}` : ""}`;

          const res = await fetch(`${GATEWAY_URL}/emails`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${lovableKey}`,
              "X-Connection-Api-Key": resendKey,
            },
            body: JSON.stringify({
              from,
              to: recipients,
              subject,
              html,
            }),
          });
          const json = await res.json().catch(() => ({}));
          if (!res.ok) {
            return Response.json({
              ok: false,
              error: `resend_${res.status}`,
              detail: json,
              recipients,
            });
          }
          return Response.json({ ok: true, sent: recipients.length, recipients, id: (json as any)?.id ?? null });
        } catch (e: any) {
          console.error("[notification-email-dispatch] error", e);
          return Response.json({ ok: false, error: e?.message ?? "internal" });
        }
      },
    },
  },
});

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function renderEmail(o: {
  title: string;
  body: string;
  url: string;
  reference: string | null;
  type: string;
  priority: string;
}): string {
  const bodyHtml = escapeHtml(o.body).replace(/\n/g, "<br />");
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111">
  <div style="max-width:560px;margin:24px auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e5e5">
    <div style="padding:16px 24px;background:linear-gradient(90deg,#C9972B,#E4C26A);color:#1a1a1a;font-weight:600;letter-spacing:.3px">Hotel Excella · Operations</div>
    <div style="padding:24px">
      <h1 style="font-size:18px;margin:0 0 8px 0">${escapeHtml(o.title)}</h1>
      <div style="font-size:12px;color:#666;margin-bottom:16px">${escapeHtml(o.type)} · ${escapeHtml(o.priority)}${o.reference ? ` · ${escapeHtml(o.reference)}` : ""}</div>
      <div style="font-size:14px;line-height:1.55">${bodyHtml}</div>
      <div style="margin-top:24px">
        <a href="${escapeHtml(o.url)}" style="display:inline-block;background:#1a1a1a;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px;font-weight:600">Open in PMS</a>
      </div>
    </div>
    <div style="padding:12px 24px;background:#fafafa;color:#999;font-size:11px">This is an operational notification from Hotel Excella PMS. Manage recipients in Settings → General.</div>
  </div>
</body></html>`;
}
