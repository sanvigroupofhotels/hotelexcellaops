/**
 * Push Notification Dispatcher
 *
 * Called by the `notifications_dispatch_push` trigger after a new in-app
 * notification is inserted. Fans out a Web Push delivery to every matching
 * push_subscriptions row.
 *
 * Push is ADDITIVE — failures here NEVER block or alter the in-app
 * notification. We always respond 200 with a body describing the outcome.
 */
import { createFileRoute } from "@tanstack/react-router";

// `web-push` is a Node-only library; load lazily so route module never crashes
// the worker bundle if the package fails to resolve.
async function getWebPush() {
  // @ts-ignore - no types bundled
  const mod: any = await import("web-push");
  return mod.default ?? mod;
}

export const Route = createFileRoute("/api/public/push-dispatch")({
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

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          const { data: n, error: nErr } = await supabaseAdmin
            .from("notifications" as any)
            .select("id,title,body,entity_type,entity_id,metadata,audience_role,user_id,priority")
            .eq("id", notification_id)
            .maybeSingle();
          if (nErr || !n) {
            return Response.json({ ok: false, error: nErr?.message ?? "not_found" });
          }
          const notif: any = n;

          // Fetch subscriptions: targeted user OR role audience OR all (broadcast).
          let query = supabaseAdmin.from("push_subscriptions" as any).select("*");
          if (notif.user_id) query = query.eq("user_id", notif.user_id);
          else if (notif.audience_role) query = query.eq("audience_role", notif.audience_role);
          const { data: subs = [], error: sErr } = await query;
          if (sErr) return Response.json({ ok: false, error: sErr.message });

          const vapidPublic = process.env.VAPID_PUBLIC_KEY;
          const vapidPrivate = process.env.VAPID_PRIVATE_KEY;
          const vapidSubject = process.env.VAPID_SUBJECT || "mailto:reception@hotelexcella.in";
          if (!vapidPublic || !vapidPrivate) {
            return Response.json({ ok: false, error: "vapid_not_configured", sent: 0 });
          }

          let webpush: any;
          try {
            webpush = await getWebPush();
            webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);
          } catch (e: any) {
            return Response.json({ ok: false, error: `web_push_load_failed: ${e?.message ?? e}` });
          }

          const url = entityUrl(notif);
          const payload = JSON.stringify({
            notification_id: notif.id,
            title: notif.title,
            body: notif.body,
            url,
            tag: `notif-${notif.id}`,
          });

          let sent = 0;
          let pruned = 0;
          await Promise.all((subs as any[]).map(async (s) => {
            try {
              await webpush.sendNotification(
                { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
                payload,
                { TTL: 60 * 60 * 24 },
              );
              sent++;
            } catch (err: any) {
              const code = err?.statusCode;
              if (code === 404 || code === 410) {
                await supabaseAdmin.from("push_subscriptions" as any).delete().eq("endpoint", s.endpoint);
                pruned++;
              }
            }
          }));

          return Response.json({ ok: true, sent, pruned, total: (subs as any[]).length });
        } catch (e: any) {
          console.error("[push-dispatch] error", e);
          return Response.json({ ok: false, error: e?.message ?? "internal" });
        }
      },
    },
  },
});

function entityUrl(n: any): string {
  if (!n.entity_type || !n.entity_id) return "/";
  switch (n.entity_type) {
    case "booking": return `/bookings/${n.entity_id}`;
    case "customer": return `/customers/${n.entity_id}`;
    case "complaint": return `/complaints/${n.entity_id}`;
    case "lead": {
      const draftId = n.metadata?.draft_booking_id || n.metadata?.booking_id;
      return typeof draftId === "string" ? `/bookings/${draftId}/edit` : "/follow-ups";
    }
    case "payment": return "/reporting/payments";
    case "review": return "/reporting/crm-analytics";
    case "night_audit": return "/night-audit";
    default: return "/";
  }
}
