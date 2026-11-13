# Architecture Rules

- HEOS MCP is one-hotel-per-instance; all tools derive scope from the authenticated identity and never accept a hotel selector.
- MCP data access always forwards a verified HEOS bearer through caller-scoped RLS and `my_permissions()`; tool handlers never use service-role access.
- Machine integrations use dedicated auditable HEOS identities, never human impersonation; their credential exchange is isolated from interactive OAuth.
- MCP write tools remain unavailable until explicitly implemented through canonical HEOS engines with confirmation and audit safeguards.
- House View grouped-chip geometry stays in a display-only helper; multi-day groups use separate tracks to preserve spans without changing occupancy engines.
- Cancellation and No-Show use a fresh caller-scoped role check before side effects plus database transition guards on bookings and booking items; UI role flags alone cannot authorize writes.
- Upload photo compression uses one dynamically loaded browser-only helper immediately before transmission; preserve non-image originals and fall back on codec failure so uploads remain compatible.
- The shared startup reveal is display-only and short-lived, excludes machine/OAuth endpoints, and honors reduced motion so it never delays navigation or authentication.