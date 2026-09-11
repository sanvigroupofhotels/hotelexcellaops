import { defineTool } from "@lovable.dev/mcp-js";
import { getBusinessDate } from "@/lib/night-audit-api";
import { guarded, ok, requirePerm } from "../guard";

export default defineTool({
  name: "get_business_date",
  title: "Get business date",
  description: "Return the current HEOS operational business date.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: guarded(async (_input, ctx) => {
    const client = await requirePerm(ctx);
    return ok({ business_date: await getBusinessDate(client) });
  }),
});