# Architecture Rules

- HEOS MCP is one-hotel-per-instance; all tools derive scope from the authenticated identity and never accept a hotel selector.
- MCP data access always forwards a verified HEOS bearer through caller-scoped RLS and `my_permissions()`; tool handlers never use service-role access.
- Machine integrations use dedicated auditable HEOS identities, never human impersonation; their credential exchange is isolated from interactive OAuth.
- MCP write tools remain unavailable until explicitly implemented through canonical HEOS engines with confirmation and audit safeguards.
- House View grouped-chip geometry stays in a display-only helper; multi-day groups use separate tracks to preserve spans without changing occupancy engines.
- House View owns its responsive controls outside the shared Topbar; desktop inline and mobile dialog legends share one content renderer so layout changes cannot alter booking operations or diverge in meaning.
- Cancellation and No-Show use a fresh caller-scoped role check before side effects plus database transition guards on bookings and booking items; UI role flags alone cannot authorize writes.
- Upload photo compression uses one dynamically loaded browser-only helper immediately before transmission; preserve non-image originals and fall back on codec failure so uploads remain compatible.
- Keep one shared display-only startup reveal, claimed once per browser session after hydration; exclude machine/OAuth endpoints and skip reduced motion so authentication and navigation never wait for it.
- Public WhatsApp booking slot selections use canonical timing windows and per-room allocation/pricing; never fabricate exact expected timestamps from a pricing-window selection, which would imply an arrival time the guest did not provide.- Booking duplicate detection runs through one shared lookup (booking-duplicates-api) as an advisory confirm before creation; every channel reuses it so rules never diverge.
- WhatsApp Inbox reads the leads table via listLeads and reuses checkBookingDuplicates for its active-stay banner; it never writes bookings directly.
- All invoice surfaces use loadInvoiceData after caller/token authorization, buildInvoiceDocument, and one PDF renderer; this prevents omitted charges, identity, room numbers or guest billing from diverging.
- Branding is the authoritative editable document identity; legacy hotel settings are read-only fallback data so older settings remain compatible without competing editors.
- Invoice presentation preserves stored folio totals and canonical pricing, splits existing accommodation GST at the hotel place of supply, and saves billing only to the linked customer through caller-scoped access.
- WhatsApp mixed-category requests share one allocation/estimate planner and an atomic service-only inventory transaction; this keeps estimates, persisted guests and room holds aligned.
- Additional stay breakdowns aggregate typed quantities in shared pricing; portal and invoices consume them without independent fee formulas.
- Push dispatch resolves operational audiences from current user roles rather than a cached single subscription role; role changes must immediately change delivery eligibility.
