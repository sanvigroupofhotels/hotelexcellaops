// Public endpoint to purge expired guest documents.
// Retention period is configurable via Settings → Documents Retention
// (app_settings key="documents_retention", { retention_days }). 0 = never delete.
//
// Schedule via pg_cron to hit:
//   POST /api/public/cleanup-guest-documents
//   header: x-cleanup-secret: <CLEANUP_SECRET or RAZORPAY_WEBHOOK_SECRET>
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/cleanup-guest-documents")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = request.headers.get("x-cleanup-secret");
        const expected = process.env.CLEANUP_SECRET || process.env.RAZORPAY_WEBHOOK_SECRET;
        if (!expected || secret !== expected) {
          return new Response("Unauthorized", { status: 401 });
        }
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Resolve retention from app_settings (default 60 days).
        const { data: settingRow } = await supabaseAdmin
          .from("app_settings" as any)
          .select("value")
          .eq("key", "documents_retention")
          .maybeSingle();
        const retentionDays = Number((settingRow as any)?.value?.retention_days ?? 60);

        if (retentionDays === 0) {
          return new Response(JSON.stringify({
            skipped: true, reason: "Retention disabled (Never Delete)",
          }), { status: 200, headers: { "content-type": "application/json" } });
        }

        const cutoffIso = new Date(Date.now() - retentionDays * 86_400_000).toISOString();
        const nowIso = new Date().toISOString();

        // Find rows that have aged past retention OR were explicitly marked expired
        // (e.g. by the bookings cancel/delete trigger).
        const { data: rows, error: listErr } = await supabaseAdmin
          .from("guest_documents" as any)
          .select("id, front_path, back_path, selfie_path, uploaded_at, expires_at")
          .or(`uploaded_at.lt.${cutoffIso},expires_at.lt.${nowIso}`);
        if (listErr) {
          return new Response(JSON.stringify({ error: listErr.message }), { status: 500 });
        }

        const paths: string[] = [];
        const ids: string[] = [];
        for (const r of (rows ?? []) as any[]) {
          ids.push(r.id);
          if (r.front_path) paths.push(r.front_path);
          if (r.back_path) paths.push(r.back_path);
          if (r.selfie_path) paths.push(r.selfie_path);
        }

        if (paths.length > 0) {
          await supabaseAdmin.storage.from("guest-documents").remove(paths);
        }
        if (ids.length > 0) {
          await supabaseAdmin.from("guest_documents" as any).delete().in("id", ids);
        }

        return new Response(JSON.stringify({
          retention_days: retentionDays,
          purged_rows: ids.length,
          purged_files: paths.length,
        }), { status: 200, headers: { "content-type": "application/json" } });
      },
    },
  },
});
