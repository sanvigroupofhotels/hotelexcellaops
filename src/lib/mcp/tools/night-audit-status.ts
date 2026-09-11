import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { getPendingForAudit } from "@/lib/night-audit-api";
import { guarded, ok, PERM, requirePerm } from "../guard";

export default defineTool({
  name: "night_audit_status",
  title: "Get Night Audit status",
  description: "Return item-aware pending arrivals and departures for Night Audit. This tool cannot close the audit.",
  inputSchema: { business_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: guarded(async ({ business_date }, ctx) => {
    const client = await requirePerm(ctx, PERM.nightAudit);
    const result = await getPendingForAudit(business_date, client);
    return ok({ business_date: result.businessDate, can_close: result.pendingCheckIns.length === 0 && result.pendingCheckOuts.length === 0, pending_check_ins: result.pendingCheckIns, pending_check_outs: result.pendingCheckOuts });
  }),
});