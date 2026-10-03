import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/.well-known/oauth-authorization-server/api/public/mulesoft-oauth")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const origin = new URL(request.url).origin;
        return Response.json({
          issuer: `${origin}/api/public/mulesoft-oauth`,
          token_endpoint: `${origin}/api/public/mulesoft-oauth/token`,
          grant_types_supported: ["client_credentials"],
          token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post"],
          scopes_supported: ["heos.read"],
          response_types_supported: [],
        });
      },
    },
  },
});
