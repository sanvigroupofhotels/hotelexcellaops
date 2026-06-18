// Public endpoint to perform automatic night audit.
// Scheduled by pg_cron daily at 12:00 PM (IST recommended).
//
//   POST /api/public/night-audit
//   header: apikey: <SUPABASE_PUBLISHABLE_KEY>
//
// Behavior:
//   - Reads business_date from app_settings (default = today local)
//   - Lists pending check-ins / check-outs (same rule as the UI)
//   - If any pending → does NOT advance business date, returns 200 with
//     `{ ok: false, reason }`. The UI is responsible for surfacing the banner.
//   - Else → advances business_date by +1 day and writes a row to
//     night_audit_runs (mode = 'auto').
import { createFileRoute } from "@tanstack/react-router";

function ymd(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function addDays(d: string, n: number) {
  const dt = new Date(d + "T00:00:00");
  dt.setDate(dt.getDate() + n);
  return ymd(dt);
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

        const [{ data: ci }, { data: co }] = await Promise.all([
          supabaseAdmin.from("bookings" as any)
            .select("id")
            .lte("check_in", businessDate)
            .not("status", "in", "(Checked-In,Checked-Out,Cancelled,Stay Completed)"),
          supabaseAdmin.from("bookings" as any)
            .select("id")
            .lte("check_out", businessDate)
            .eq("status", "Checked-In" as any),
        ]);

        const pendingIn = (ci ?? []).length;
        const pendingOut = (co ?? []).length;

        if (pendingIn > 0 || pendingOut > 0) {
          return new Response(JSON.stringify({
            ok: false,
            business_date: businessDate,
            pending_check_ins: pendingIn,
            pending_check_outs: pendingOut,
            reason: pendingIn > 0 ? "pending_check_ins" : "pending_check_outs",
          }), { status: 200, headers: { "content-type": "application/json" } });
        }

        const next = addDays(businessDate, 1);

        // Idempotency: insert audit row first; UNIQUE(previous_business_date) prevents double-advance.
        const { error: insErr } = await supabaseAdmin.from("night_audit_runs" as any).insert({
          user_id: null,
          actor_name: "system (cron)",
          mode: "auto",
          previous_business_date: businessDate,
          new_business_date: next,
          pending_check_ins_resolved: 0,
          pending_check_outs_resolved: 0,
          notes: null,
        } as any);
        if (insErr) {
          const code = (insErr as any).code;
          if (code === "23505") {
            return new Response(JSON.stringify({
              ok: false, reason: "already_done", business_date: businessDate,
            }), { status: 200, headers: { "content-type": "application/json" } });
          }
          return new Response(JSON.stringify({ ok: false, error: (insErr as any).message }), { status: 500, headers: { "content-type": "application/json" } });
        }
        await supabaseAdmin.from("app_settings" as any).upsert({
          key: "business_date", value: { date: next }, updated_at: new Date().toISOString(),
        } as any);

        return new Response(JSON.stringify({
          ok: true,
          previous_business_date: businessDate,
          new_business_date: next,
        }), { status: 200, headers: { "content-type": "application/json" } });
      },
    },
  },
});
