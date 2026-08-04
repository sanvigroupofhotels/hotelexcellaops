// Automatic Night Audit runner.
//
//   POST /api/public/night-audit-run
//   header: apikey: <SUPABASE_PUBLISHABLE_KEY>
//
// Scheduled by pg_cron at 00:30 UTC == 06:00 IST daily. It drives the SAME
// shared engine Reception uses (`night-audit-sessions-api.closeSession`) via
// the injectable DB handle — there is no second audit implementation.
//
// Idempotent: repeat calls for a Business Date that is already current, or
// already closed by an automatic run, return `already_current` / `already_ran`.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/night-audit-run")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apikey = request.headers.get("apikey");
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY;
        if (!expected || apikey !== expected) {
          return new Response("Unauthorized", { status: 401 });
        }

        const [{ supabaseAdmin }, { withDb }, { runScheduledNightAudit }] = await Promise.all([
          import("@/integrations/supabase/client.server"),
          import("@/lib/db"),
          import("@/lib/night-audit-scheduler"),
        ]);

        try {
          const result = await withDb(supabaseAdmin as any, () =>
            runScheduledNightAudit({ actorName: "Automatic Night Audit (06:00 IST)" }),
          );
          console.log("[night-audit-run]", JSON.stringify(result));
          return new Response(JSON.stringify(result), {
            status: result.ok ? 200 : 409,
            headers: { "content-type": "application/json" },
          });
        } catch (e: any) {
          console.error("[night-audit-run] fatal", e?.message ?? e);
          return new Response(
            JSON.stringify({ ok: false, status: "failed", error: e?.message ?? "unknown error" }),
            { status: 500, headers: { "content-type": "application/json" } },
          );
        }
      },
    },
  },
});
