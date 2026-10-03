# MuleSoft service identity and machine OAuth

## Goal
Connect MuleSoft Agent Fabric through its required `client_credentials` flow while keeping HEOS’s existing user-consent OAuth unchanged for Claude and other interactive clients.

## Implementation
1. **Dedicated identity**
   - Provision `mulesoft@hotelexcella.in` as a non-interactive HEOS identity named “MuleSoft Integration”.
   - Assign the existing `owner` role, so permissions continue to come from `my_permissions()` and existing database access policies.
   - Keep its password generated and stored securely; it will never be displayed or used for staff login.

2. **MuleSoft-specific OAuth adapter**
   - Add a standards-based `client_credentials` token endpoint that validates only the dedicated MuleSoft Client ID and Client Secret.
   - Exchange that validated machine identity internally for a short-lived HEOS access token belonging to the MuleSoft identity.
   - Return no refresh token and never expose the internal service-account password.
   - Publish OAuth authorization-server metadata advertising only `client_credentials` for this adapter.

3. **Dedicated MCP URL**
   - Expose the existing 21 tools at `https://ops.hotelexcella.in/mcp/mulesoft` with protected-resource metadata pointing to the MuleSoft OAuth adapter.
   - Keep `https://ops.hotelexcella.in/mcp` unchanged for Authorization Code + PKCE clients such as Claude.
   - Both URLs use the same tool definitions and shared HEOS read engines; there is no duplicate operational implementation.

4. **Authorization boundaries**
   - Pass the short-lived HEOS bearer token through the existing caller-scoped database client.
   - Preserve row-level access controls, `my_permissions()`, one-hotel-per-instance scope, and the current read-only Phase 1 boundary.
   - Do not add write tools. Future write tools will still require explicit implementation through existing HEOS business engines and safeguards.

5. **Verification**
   - Test OAuth metadata, valid and invalid client authentication, token issuance, MCP initialization, `whoami`, and discovery of all 21 tools.
   - Confirm the normal `/mcp` OAuth challenge and Claude-compatible discovery remain unchanged.
   - Run the build checks and security scan.

## Technical details
- MuleSoft credentials are stored only as runtime secrets; the Client Secret is never committed or logged.
- The service account is a real HEOS auth identity so `auth.uid()`, role policies, and `my_permissions()` continue to work without privileged database bypasses.
- MuleSoft should be configured with the new `/mcp/mulesoft` URL after deployment, using its dedicated Client ID and Client Secret.
