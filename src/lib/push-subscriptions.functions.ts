import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/**
 * Upsert a push subscription for the signed-in user. Idempotent on endpoint.
 */
export const savePushSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    endpoint: z.string().url().max(2048).refine((url) => new URL(url).protocol === "https:"),
    p256dh: z.string().min(16).max(256), auth: z.string().min(8).max(256), user_agent: z.string().max(1000).nullable().optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("push_subscriptions" as any)
      .upsert(
        {
          user_id: userId,
          audience_role: null,
          endpoint: data.endpoint,
          p256dh: data.p256dh,
          auth: data.auth,
          user_agent: data.user_agent ?? null,
          last_seen_at: new Date().toISOString(),
        },
        { onConflict: "endpoint" },
      );
    if (error) throw error;
    return { ok: true };
  });

export const removePushSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ endpoint: z.string().url().max(2048) }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("push_subscriptions" as any)
      .delete()
      .eq("endpoint", data.endpoint);
    if (error) throw error;
    return { ok: true };
  });
