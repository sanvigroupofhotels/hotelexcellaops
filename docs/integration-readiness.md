# HEOS v1.0 — Integration Readiness Review

_Documentation only. Confirms HEOS can integrate cleanly with each target
system without operational-module changes. Reviewed 2026-07-09 in
Shipment 3B._

## Integration surface summary

| System                       | Surface                                             | Ready? | Notes |
|------------------------------|-----------------------------------------------------|--------|-------|
| WhatsApp Business API        | Notification engine adapter                         | 🟢     | Add adapter under `lib/notifications/`; engine already transport-agnostic. |
| Email providers (Resend/SES) | `notification-email-dispatch.ts`                    | 🟢     | Already implemented; swap provider by env var. |
| SMS providers                | Notification engine adapter                         | 🟢     | Same adapter shape as WhatsApp. |
| Web Push                     | `push-dispatch.ts` + `push-subscriptions.functions` | 🟢     | Live. |
| Google Calendar              | Server function reading `bookings` / `housekeeping_tasks` | 🟢 | Read-only export first; two-way sync requires idempotency keys. |
| Google Ads                   | Conversion API webhook from `LeadConverted` / `BookingCreated` | 🟢 | Events already emitted; add outbound webhook. |
| Meta Ads (FB/IG)             | Conversions API — same event surface                | 🟢     | Same pattern as Google Ads. |
| Google Business Profile      | Manual API — post to GMB from `GuestReviewSubmitted` events | 🟡 | Requires GBP OAuth; not urgent. |
| Instagram / Facebook DM      | via Meta Business inbox                             | 🟡     | Same OAuth as Meta Ads; deferred. |
| Payment gateways             | Razorpay integrated; adapter shape reusable         | 🟢     | Add Stripe/other under the same webhook contract at `api/public/*-webhook.ts`. |
| Accounting (Tally/Zoho/QB)   | Nightly export from `cash_transactions`, `booking_payments`, `vendors` | 🟢 | Read-only server function; no schema change. |
| BI dashboards                | Reporting engines in `src/lib/reporting/*`          | 🟢     | Can back a Metabase/Superset feed via REST or direct read-replica. |
| OpenAI / LLM                 | Lovable AI Gateway (already used for OCR)           | 🟢     | Add a copilot server function; consume shared engines from `docs/ai-readiness.md`. |
| Vector knowledge base        | Any (Pinecone/pgvector)                             | 🟢     | Suggest pgvector in the same Supabase project. |
| n8n / workflow automation    | Webhooks from event outbox                          | 🟡     | Requires event outbox (see `docs/events.md §Migration path`). |
| Multi-property               | Add `property_id` to core tables + RLS scope        | 🟡     | Non-trivial; separate SPRINT before it's needed. |

## Architectural guarantees that enable this

1. **Every user-facing operation flows through a shared engine.** External
   integrations call the same engine — never raw table writes — so
   integration paths inherit validation, permissions, and side-effects.
2. **All webhooks land under `/api/public/*`.** Prefix bypasses auth on
   published sites; every handler MUST verify signature before writing.
   Existing pattern: `api/public/razorpay-webhook.ts`.
3. **Notifications are decoupled.** Adding WhatsApp/SMS/Slack is one
   adapter under `lib/notifications/*` — no touch to bookings, HK, cash,
   or reporting.
4. **Reporting engines are read-only aggregation.** They are safe to
   expose to BI without leaking write paths.
5. **RLS everywhere.** Any external caller reads through
   `supabase-js` with either the anon key (public data), a per-user
   token, or a signed service-role call from a verified webhook.

## Blocking items before external integrations go live
- None architectural. The remaining items (WhatsApp/SMS templates,
  outbox for n8n, multi-property `property_id`) are additive, not
  refactors.

---

## v1.0 integration roadmap (future)

Each row lists status, HEOS surface it plugs into, and the engine that
already exists to absorb it (no redesign required).

| Integration              | Status  | Surface / Engine                                     |
|--------------------------|---------|------------------------------------------------------|
| WhatsApp Business API    | Planned | Notification channel adapter                         |
| Email (SES/SendGrid)     | Live†   | `crm_outbound_emails` + `notification-email-dispatch`|
| SMS                      | Planned | Notification channel adapter                         |
| Web Push                 | Live    | `push-dispatch` + `push_subscriptions`               |
| Google Calendar          | Planned | Booking read stream                                  |
| Google Ads               | Planned | Lead ingest + attribution                            |
| Meta Ads                 | Planned | Lead ingest + attribution                            |
| Google Business Profile  | Planned | Review AI + guest_reviews                            |
| Instagram / Facebook     | Planned | Lead ingest                                          |
| Payment Gateways         | Live    | Razorpay engine                                      |
| Accounting               | Planned | Cash Book export adapter                             |
| Power BI                 | Planned | Reporting export                                     |
| Metabase                 | Planned | Direct DB read via read-only role                    |
| OpenAI / LLM Gateway     | Planned | AI agent runtime (`ai-roadmap.md`)                   |
| Vector Database          | Planned | Guest history retrieval for AI                       |
| n8n                      | Planned | Workflow automation (subscribes to events)           |
| Multi-property           | Planned | Property-scoped RLS + tenant column additions        |

† Transactional email scaffolded; broad campaign use pending config.

All integrations plug through existing seams: the notification engine
for outbound comms, `activity_log` / `booking_activities` for event
streams, and `/api/public/*` webhooks (signature-verified) for inbound.
