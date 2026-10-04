# Fix MuleSoft OAuth discovery

## Goal
Make MuleSoft accept the HEOS OAuth metadata and proceed with its existing client-credentials connection test.

## Changes
- Add the required `authorization_endpoint` field to both MuleSoft OAuth discovery responses.
- Add a safe authorization endpoint that reports unsupported interactive authorization without changing the client-credentials flow.
- Keep the dedicated MuleSoft identity, RLS, permission checks, 21 read-only tools, and Claude OAuth unchanged.
- Verify discovery, token issuance, MCP initialization, tool discovery, and invalid-client rejection; then publish the corrected endpoint.

## Technical details
MuleSoft validates `authorization_endpoint` as mandatory even though it requests `client_credentials`. The endpoint will be present for metadata compatibility, while `grant_types_supported` remains limited to `client_credentials`.
