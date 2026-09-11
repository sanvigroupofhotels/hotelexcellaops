import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { listBookingPayments } from "@/lib/booking-payments-api";
import { guarded, money, ok, PERM, requirePerm } from "../guard";

export default defineTool({
  name: "list_booking_payments",
  title: "List booking payments",
  description: "List safe payment records for a booking without gateway payloads or secrets.",
  inputSchema: { booking_id: z.string().uuid() },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: guarded(async ({ booking_id }, ctx) => {
    const client = await requirePerm(ctx, PERM.finance);
    const rows = (await listBookingPayments(booking_id, client)).map((r: any) => ({ id: r.id, amount: money(r.amount), mode: r.mode, payment_date: r.payment_date, status: r.status ?? null, reference: r.reference ?? null, item_id: r.item_id ?? null }));
    return ok({ booking_id, count: rows.length, total: money(rows.reduce((s, r) => s + r.amount, 0)), rows });
  }),
});