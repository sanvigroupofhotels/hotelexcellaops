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
  name: "whoami",
  title: "Who am I",
  description:
    "Returns the signed-in Hotel Excella user's id, email, and roles. Use to verify the MCP connection is authenticated as the expected user.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_input, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    const { data: rolesRows, error: rolesErr } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", ctx.getUserId());
    if (rolesErr) {
      return { content: [{ type: "text", text: rolesErr.message }], isError: true };
    }
    const roles = (rolesRows ?? []).map((r: any) => r.role);
    const payload = {
      user_id: ctx.getUserId(),
      email: ctx.getUserEmail() ?? null,
      roles,
    };
    return {
      content: [{ type: "text", text: JSON.stringify(payload) }],
      structuredContent: payload,
    };
  },
});
