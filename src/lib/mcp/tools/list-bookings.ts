import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { capLimit, guarded, ok, PERM, requirePerm } from "../guard";

const BOOKING_STATUSES = ["Advance Paid", "Cancelled", "Checked-In", "Checked-Out", "Confirmed", "Draft", "Full Paid", "No-Show", "Pending", "Stay Completed"] as const;

export default defineTool({
  name: "list_bookings",
  title: "List bookings",
  description:
    "List bookings visible to the signed-in user in this HEOS hotel instance. Supports optional filters: status, arriving-on date (YYYY-MM-DD), and a text search over guest name or booking reference. Returns up to 50 most-recent bookings.",
  inputSchema: {
    status: z
      .enum(BOOKING_STATUSES)
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
  handler: guarded(async ({ status, arriving_on, search, limit }, ctx) => {
    const cap = Math.min(capLimit(limit, 25), 50);
    const supabase = await requirePerm(ctx, PERM.bookings);
    let query = supabase
      .from("bookings")
      .select(
        "id, booking_reference, guest_name, status, check_in, check_out, amount, advance_paid, created_at",
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
      throw error;
    }
    const rows = data ?? [];
    return ok({ count: rows.length, rows });
  }),
});
