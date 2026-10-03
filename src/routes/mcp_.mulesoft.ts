import { createFileRoute } from "@tanstack/react-router";
import { createTanStackMcpHandler } from "@lovable.dev/mcp-js/stacks/tanstack";
import mcp from "../lib/mcp/mulesoft";

export const Route = createFileRoute("/mcp_/mulesoft")({
  server: {
    handlers: {
      ANY: createTanStackMcpHandler(mcp, {
        resourcePath: "/mcp/mulesoft",
        metadataPath: "/.well-known/oauth-protected-resource/mulesoft",
        trustForwardedHost: true,
      }),
    },
  },
});
