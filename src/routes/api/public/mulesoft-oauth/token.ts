import { createFileRoute } from "@tanstack/react-router";

function clientCredentials(request: Request, body: URLSearchParams) {
  const authorization = request.headers.get("authorization") ?? "";
  if (authorization.startsWith("Basic ")) {
    try {
      const decoded = atob(authorization.slice(6));
      const separator = decoded.indexOf(":");
      if (separator >= 0) {
        return {
          clientId: decodeURIComponent(decoded.slice(0, separator)),
          clientSecret: decodeURIComponent(decoded.slice(separator + 1)),
        };
      }
    } catch {
      return { clientId: "", clientSecret: "" };
    }
  }
  return {
    clientId: body.get("client_id") ?? "",
    clientSecret: body.get("client_secret") ?? "",
  };
}

const noStoreHeaders = {
  "cache-control": "no-store",
  pragma: "no-cache",
};

export const Route = createFileRoute("/api/public/mulesoft-oauth/token")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const contentType = request.headers.get("content-type") ?? "";
        if (!contentType.includes("application/x-www-form-urlencoded")) {
          return Response.json(
            { error: "invalid_request", error_description: "Form-encoded request required" },
            { status: 400, headers: noStoreHeaders },
          );
        }

        const body = new URLSearchParams(await request.text());
        if (body.get("grant_type") !== "client_credentials") {
          return Response.json(
            { error: "unsupported_grant_type" },
            { status: 400, headers: noStoreHeaders },
          );
        }

        const { clientId, clientSecret } = clientCredentials(request, body);
        const { verifyMuleSoftClient, issueMuleSoftAccessToken } = await import(
          "@/lib/mcp/mulesoft-auth.server"
        );
        if (!(await verifyMuleSoftClient(clientId, clientSecret))) {
          return Response.json(
            { error: "invalid_client" },
            {
              status: 401,
              headers: { ...noStoreHeaders, "www-authenticate": 'Basic realm="HEOS MuleSoft OAuth"' },
            },
          );
        }

        try {
          return Response.json(await issueMuleSoftAccessToken(), { headers: noStoreHeaders });
        } catch (error) {
          console.error("[mulesoft-oauth] token issuance failed", error instanceof Error ? error.message : "unknown");
          return Response.json(
            { error: "temporarily_unavailable" },
            { status: 503, headers: { ...noStoreHeaders, "retry-after": "5" } },
          );
        }
      },
    },
  },
});
