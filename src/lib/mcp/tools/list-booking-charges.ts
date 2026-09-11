import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { listBookingCharges } from "@/lib/booking-charges-api";
import { guarded, money, ok, PERM, requirePerm } from "../guard";

export default defineTool({
  name: "list_booking_charges",
  title: "List booking charges",
  description: "List additional charges with booking-room attribution, excluding audit internals.",
  inputSchema: { booking_id: z.string().uuid() },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: guarded(async ({ booking_id }, ctx) => {
    const client = await requirePerm(ctx, PERM.finance);
    const rows = (await listBookingCharges(booking_id, client)).map((r: any) => ({ id: r.id, item_id: r.item_id ?? null, category: r.category, description: r.other_description ?? null, quantity: r.quantity, unit_price: money(r.unit_price), amount: money(r.amount), charge_date: r.charge_date, price_overridden: !!r.price_overridden }));
    return ok({ booking_id, count: rows.length, total: money(rows.reduce((s, r) => s + r.amount, 0)), rows });
  }),
});