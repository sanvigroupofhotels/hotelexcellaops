import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Admin-only operations for the Push Notification framework.
 *
 *   - getPushDispatchConfig:  diagnostic view of app_settings + env wiring
 *   - configurePushDispatch:  one-click sync of env secret + URL into app_settings
 *   - sendTestPush:           insert a synthetic notification targeted at the caller
 *
 * All require the caller to hold the `admin` role.
 */

async function assertAdmin(ctx: any) {
  const { data, error } = await ctx.supabase.rpc("has_role", {
    _user_id: ctx.userId,
    _role: "admin",
  });
  if (error || !data) throw new Error("Forbidden — admin role required");
}

export const getPushDispatchConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("app_settings" as any)
      .select("key,value")
      .in("key", ["push_dispatch_url", "push_dispatch_secret"]);

    const map = new Map((data ?? []).map((r: any) => [r.key, r.value]));
    const url = String(map.get("push_dispatch_url") ?? "");
    const secret = String(map.get("push_dispatch_secret") ?? "");

    return {
      push_dispatch_url: url,
      push_dispatch_secret_present: secret.length > 0,
      env_secret_present: Boolean(process.env.PUSH_DISPATCH_SECRET),
      env_vapid_public_present: Boolean(process.env.VAPID_PUBLIC_KEY),
      env_vapid_private_present: Boolean(process.env.VAPID_PRIVATE_KEY),
      env_vapid_subject: process.env.VAPID_SUBJECT ?? null,
      secret_matches_env:
        secret.length > 0 && process.env.PUSH_DISPATCH_SECRET === secret,
    };
  });

export const configurePushDispatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { origin: string }) => d)
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const envSecret = process.env.PUSH_DISPATCH_SECRET;
    if (!envSecret) throw new Error("PUSH_DISPATCH_SECRET env var is not configured on the server");
    if (!process.env.VAPID_PRIVATE_KEY) throw new Error("VAPID_PRIVATE_KEY env var is not configured on the server");
    if (!process.env.VAPID_PUBLIC_KEY) throw new Error("VAPID_PUBLIC_KEY env var is not configured on the server");

    const origin = data.origin.replace(/\/+$/, "");
    if (!/^https?:\/\//.test(origin)) throw new Error("origin must be a fully-qualified URL");
    const url = `${origin}/api/public/push-dispatch`;

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const rows = [
      { key: "push_dispatch_url", value: url as any },
      { key: "push_dispatch_secret", value: envSecret as any },
    ];
    const { error } = await supabaseAdmin
      .from("app_settings" as any)
      .upsert(rows, { onConflict: "key" });
    if (error) throw error;

    return { ok: true, push_dispatch_url: url };
  });

export const sendTestPush = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("notifications" as any)
      .insert({
        type: "test",
        title: "Push test — Hotel Excella",
        body: "If you can read this on your device, push delivery is working end-to-end.",
        user_id: context.userId,
        priority: "low",
        status: "unread",
        metadata: { source: "admin_test", origin: "settings_general" },
      })
      .select("id")
      .single();
    if (error) throw error;
    return { ok: true, notification_id: (data as any).id };
  });

export const sendTestInAppNotification = sendTestPush; // alias for the operational shipment
