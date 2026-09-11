import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { guarded, McpToolError, money, ok, PERM, requirePerm } from "../guard";

export default defineTool({
  name: "get_booking",
  title: "Get booking",
  description: "Return a booking's safe commercial and stay details by UUID or booking reference.",
  inputSchema: { booking: z.string().trim().min(1).describe("Booking UUID or reference such as HEXB-123ABC.") },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: guarded(async ({ booking }, ctx) => {
    const client = await requirePerm(ctx, PERM.bookings);
    let q = client.from("bookings").select("id,booking_reference,guest_name,phone,email,status,payment_status,check_in,check_out,expected_arrival_at,expected_departure_at,adults,children,guests,nights,source_channel,amount,advance_paid,subtotal,discount,taxes,tax_rate,created_at,updated_at");
    q = booking.toUpperCase().startsWith("HEXB-") ? q.eq("booking_reference", booking.toUpperCase()) : q.eq("id", booking);
    const { data, error } = await q.maybeSingle();
    if (error) throw error;
    if (!data) throw new McpToolError("Booking not found or not visible to this user.");
    return ok({ booking: { ...data, amount: money(data.amount), advance_paid: money(data.advance_paid), subtotal: money(data.subtotal), discount: money(data.discount), taxes: money(data.taxes) } });
  }),
});