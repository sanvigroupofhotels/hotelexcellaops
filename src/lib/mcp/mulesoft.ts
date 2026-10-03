import { auth, defineMcp } from "@lovable.dev/mcp-js";
import { heosReadTools } from "./index";

const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "heos-mcp-mulesoft",
  title: "HEOS",
  version: "0.2.0",
  instructions:
    "Read-only operational tools for the hotel configured in this HEOS instance. Access is attributed to the dedicated MuleSoft HEOS identity and remains subject to RLS and the HEOS permission matrix.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
    requireOAuthClientClaim: false,
  }),
  tools: heosReadTools,
});
