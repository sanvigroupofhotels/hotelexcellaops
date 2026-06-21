// Public read-only endpoint to inspect the current Night Audit state.
//
//   POST /api/public/night-audit
//   header: apikey: <SUPABASE_PUBLISHABLE_KEY>
//
// IMPORTANT: As of the Reception Command Center redesign, Business Date is
// ONLY advanced through the Night Audit session close flow (see
// `closeSession` in `night-audit-sessions-api.ts`). This endpoint NEVER
// advances the business date — it only reports the current state so an
// external scheduler can alert if a session has been left open.
import { createFileRoute } from "@tanstack/react-router";

function ymd(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export const Route = createFileRoute("/api/public/night-audit")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apikey = request.headers.get("apikey");
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY;
        if (!expected || apikey !== expected) {
          return new Response("Unauthorized", { status: 401 });
        }
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const today = ymd(new Date());
        const { data: bdRow } = await supabaseAdmin
          .from("app_settings" as any)
          .select("value")
          .eq("key", "business_date")
          .maybeSingle();
        const businessDate = ((bdRow as any)?.value?.date as string | undefined) || today;

        const [{ data: ci }, { data: co }, { data: openSess }] = await Promise.all([
          supabaseAdmin.from("bookings" as any)
            .select("id")
            .lte("check_in", businessDate)
            .not("status", "in", "(Checked-In,Checked-Out,Cancelled,Stay Completed,No-Show)"),
          supabaseAdmin.from("bookings" as any)
            .select("id")
            .lte("check_out", businessDate)
            .eq("status", "Checked-In" as any),
          supabaseAdmin.from("night_audit_sessions" as any)
            .select("id,opened_at")
            .eq("business_date", businessDate)
            .eq("status", "open")
            .maybeSingle(),
        ]);

        return new Response(JSON.stringify({
          ok: true,
          mode: "read_only",
          business_date: businessDate,
          pending_check_ins: (ci ?? []).length,
          pending_check_outs: (co ?? []).length,
          open_session: openSess ?? null,
          note: "Business Date advance is owned exclusively by the Night Audit session close flow.",
        }), { status: 200, headers: { "content-type": "application/json" } });
      },
    },
  },
});
