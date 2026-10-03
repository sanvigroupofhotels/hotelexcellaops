import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/.well-known/oauth-protected-resource/mulesoft")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const origin = new URL(request.url).origin;
        return Response.json({
          resource: `${origin}/mcp/mulesoft`,
          authorization_servers: [`${origin}/api/public/mulesoft-oauth`],
          bearer_methods_supported: ["header"],
          resource_name: "HEOS",
          scopes_supported: ["heos.read"],
        });
      },
    },
  },
});
