import { defineTool } from "@lovable.dev/mcp-js";
import { guarded, ok, requirePerm } from "../guard";

export default defineTool({
  name: "whoami",
  title: "Who am I",
  description:
    "Returns the signed-in Hotel Excella user's id, email, and roles. Use to verify the MCP connection is authenticated as the expected user.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: guarded(async (_input, ctx) => {
    const supabase = await requirePerm(ctx);
    const userId = ctx.getUserId();
    if (!userId) throw new Error("Authenticated user has no user id.");
    const { data: rolesRows, error: rolesErr } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    if (rolesErr) {
      throw rolesErr;
    }
    const roles = (rolesRows ?? []).map((r: any) => r.role);
    const payload = {
      user_id: userId,
      email: ctx.getUserEmail() ?? null,
      roles,
    };
    return ok(payload);
  }),
});
