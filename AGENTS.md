# Architecture Rules

- HEOS MCP is one-hotel-per-instance; all tools derive scope from the authenticated identity and never accept a hotel selector.
- MCP data access always forwards a verified HEOS bearer through caller-scoped RLS and `my_permissions()`; tool handlers never use service-role access.
- Machine integrations use dedicated auditable HEOS identities, never human impersonation; their credential exchange is isolated from interactive OAuth.
- MCP write tools remain unavailable until explicitly implemented through canonical HEOS engines with confirmation and audit safeguards.