import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { validateCheckout } from "@/lib/checkout-validation";
import { guarded, money, ok, PERM, requirePerm } from "../guard";

export default defineTool({
  name: "get_booking_balance",
  title: "Get booking balance",
  description: "Return shared checkout-validation totals, balance due, Guest Credit, and blockers for a booking.",
  inputSchema: { booking_id: z.string().uuid() },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: guarded(async ({ booking_id }, ctx) => {
    const client = await requirePerm(ctx, PERM.finance);
    const result = await validateCheckout(booking_id, client);
    return ok({ booking_id, ...result, payable: money(result.payable), paid: money(result.paid), balance: money(result.balance), guest_credit: result.balance < 0 ? money(-result.balance) : 0 });
  }),
});