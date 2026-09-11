import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { searchBookings } from "@/lib/booking-search";
import { capLimit, guarded, ok, PERM, requirePerm } from "../guard";

export default defineTool({
  name: "search_bookings",
  title: "Search bookings",
  description: "Search bookings by reference, guest, phone, occupant, room, or company using the shared HEOS search.",
  inputSchema: {
    query: z.string().trim().min(2).describe("At least two characters."),
    limit: z.number().int().min(1).max(200).optional(),
    include_cancelled: z.boolean().optional(),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: guarded(async ({ query, limit, include_cancelled }, ctx) => {
    const client = await requirePerm(ctx, PERM.bookings);
    const rows = await searchBookings(query, {
      limit: capLimit(limit, 25),
      includeCancelled: include_cancelled ?? false,
    }, client);
    return ok({ count: rows.length, rows });
  }),
});