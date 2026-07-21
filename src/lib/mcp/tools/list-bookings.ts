import { createClient } from "@supabase/supabase-js";
import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";
import { z } from "zod";

function supabaseForUser(ctx: ToolContext) {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_PUBLISHABLE_KEY!,
    {
      global: { headers: { Authorization: `Bearer ${ctx.getToken()}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
}

export default defineTool({
  name: "list_bookings",
  title: "List bookings",
  description:
    "List Hotel Excella bookings visible to the signed-in user. Supports optional filters: status, arriving-on date (YYYY-MM-DD), and a text search over guest name or booking reference. Returns up to 50 most-recent bookings.",
  inputSchema: {
    status: z
      .string()
      .optional()
      .describe("Optional booking status filter, e.g. 'Confirmed', 'Checked-In', 'Checked-Out'."),
    arriving_on: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .describe("Optional check-in date filter in YYYY-MM-DD."),
    search: z
      .string()
      .optional()
      .describe("Optional text to match against guest name or booking reference."),
    limit: z
      .number()
      .int()
      .optional()
      .describe("Max rows to return (default 25, hard capped at 50)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ status, arriving_on, search, limit }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const cap = Math.min(Math.max(1, Number(limit ?? 25)), 50);
    const supabase = supabaseForUser(ctx);
    let query = supabase
      .from("bookings")
      .select(
        "id, booking_reference, guest_name, status, check_in, check_out, room_id, amount, balance, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(cap);

    if (status) query = query.eq("status", status);
    if (arriving_on) query = query.eq("check_in", arriving_on);
    if (search) {
      const s = search.replace(/[,%]/g, " ").trim();
      if (s) query = query.or(`guest_name.ilike.%${s}%,booking_reference.ilike.%${s}%`);
    }

    const { data, error } = await query;
    if (error) {
      return { content: [{ type: "text", text: error.message }], isError: true };
    }
    const rows = data ?? [];
    return {
      content: [{ type: "text", text: JSON.stringify(rows) }],
      structuredContent: { count: rows.length, rows },
    };
  },
});
