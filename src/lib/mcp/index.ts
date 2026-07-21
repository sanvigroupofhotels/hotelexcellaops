import { auth, defineMcp } from "@lovable.dev/mcp-js";
import whoamiTool from "./tools/whoami";
import listBookingsTool from "./tools/list-bookings";

// The OAuth issuer must be the direct Supabase host. On publish, SUPABASE_URL is
// rewritten to a .lovable.cloud proxy and rejected by mcp-js (RFC 8414 issuer
// mismatch). VITE_SUPABASE_PROJECT_ID is inlined by Vite at build time.
const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "hotel-excella-mcp",
  title: "Hotel Excella",
  version: "0.1.0",
  instructions:
    "Read-only tools for the Hotel Excella property management system. Call `whoami` to verify the connection, and `list_bookings` to read bookings visible to the signed-in user under the app's row-level permissions.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [whoamiTool, listBookingsTool],
});
