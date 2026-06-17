// Public endpoint to purge expired guest documents (60-day retention).
// Configure pg_cron or external scheduler to hit:
//   POST /api/public/cleanup-guest-documents
//   header: x-cleanup-secret: <RAZORPAY_WEBHOOK_SECRET or env CLEANUP_SECRET>
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

        // 1) Find expired rows so we can remove storage objects too.
        const { data: rows, error: listErr } = await supabaseAdmin
          .from("guest_documents" as any)
          .select("id, front_path, back_path, selfie_path, expires_at")
          .lt("expires_at", new Date().toISOString());
        if (listErr) return new Response(JSON.stringify({ error: listErr.message }), { status: 500 });

        const paths: string[] = [];
        for (const r of (rows ?? []) as any[]) {
          if (r.front_path) paths.push(r.front_path);
          if (r.back_path) paths.push(r.back_path);
          if (r.selfie_path) paths.push(r.selfie_path);
        }
        if (paths.length > 0) {
          await supabaseAdmin.storage.from("guest-documents").remove(paths);
        }

        // 2) Delete the rows.
        const { data: deleted, error: delErr } = await supabaseAdmin
          .rpc("cleanup_expired_guest_documents");
        if (delErr) return new Response(JSON.stringify({ error: delErr.message }), { status: 500 });

        return new Response(JSON.stringify({
          purged_rows: deleted ?? 0,
          purged_files: paths.length,
        }), { status: 200, headers: { "content-type": "application/json" } });
      },
    },
  },
});
