# HEOS Core v1.0 — Database Reference

68 tables in `public`. Every table has RLS enabled and explicit GRANTs.
Standard columns (`id UUID PK`, `created_at`, `updated_at`) omitted.

Legend: **[Dep]** deprecated · **[Sys]** system/config · **[Ops]**
operational · **[Log]** append-only audit.

## Core reference tables

| Table | Purpose | Key columns | Consumers |
|---|---|---|---|
| `app_settings` [Sys] | Global config incl. Business Date | `business_date`, various flags | Every module |
| `profiles` | Auth ↔ display mapping | `user_id`, `full_name`, `email` | All UI |
| `roles` | Canonical role catalog | `key`, `label` | Access |
| `permissions` | Permission key catalog | `key`, `module`, `sort_order` | Access, Sidebar |
| `role_permissions` | Role × permission matrix | `role_key`, `permission_key` | RPC `my_permissions` |
| `user_roles` | User role assignment | `user_id`, `role` | RLS `has_role()` |
| `user_permission_overrides` | Per-user grants/denials | `user_id`, `permission_key`, `granted` | RPC `my_permissions` |
| `integrations` [Sys] | 3rd-party config | `provider`, `config` | Razorpay, Hotelzify |
| `integration_runs` [Log] | Integration invocations | `provider`, `status`, `payload` | Reporting |
| `activity_log` [Log] | Global audit trail | `entity_type`, `entity_id`, `action`, `payload`, `actor_id` | Reporting, AI |
| `notifications` | In-app notifications | `audience`, `channel`, `payload`, `read_at` | Notification engine |
| `push_subscriptions` | Web-push endpoints | `user_id`, `endpoint`, `keys` | Push dispatch |
| `master_data` | Generic lookup rows | `category`, `value`, `label`, `sort_order`, `active` | All dropdowns |

## Booking domain

| Table | Purpose | Key relationships |
|---|---|---|
| `bookings` [Ops] | Booking header | `customer_id → customers`, `status`, `check_in`, `check_out`, `booking_ref` |
| `booking_items` | Rate line-items | `booking_id → bookings` |
| `booking_charges` | In-house charges | `booking_id`, `category → master_data(in_house_charge_categories)` |
| `booking_payments` | Payment ledger | `booking_id`, `method`, `amount`, `razorpay_*` |
| `booking_payment_activities` [Log] | Payment history | `payment_id` |
| `booking_room_assignments` | Multi-room support | `booking_id`, `room_id`, `check_in`, `check_out` |
| `booking_activities` [Log] | Booking lifecycle events | `booking_id`, `type`, `payload` |
| `booking_tokens` | Guest portal signed tokens | `booking_id`, `token`, `expires_at` |
| `external_bookings` [Log] | OTA / Hotelzify inbox | `provider`, `external_ref`, `raw` |
| `leads` | Pre-booking enquiries | `phone`, `email`, `status` |
| `lead_activities` [Log] | Lead history | `lead_id` |
| `promo_codes` | Discount codes | `code`, `discount_type`, `active` |
| `razorpay_orders` | Order lifecycle | `booking_id`, `order_id`, `amount`, `status` |
| `razorpay_webhook_events` [Log] | Verified webhook stream | `event_id`, `payload` |

## Customer domain

| Table | Purpose |
|---|---|
| `customers` | Unified guest record. `phone` UNIQUE, `email` optional. |
| `guest_documents` | Uploaded IDs. Retention enforced via cleanup cron. |
| `guest_reviews` | Post-stay review capture. |

## Rooms & rates

| Table | Purpose |
|---|---|
| `rooms` | Physical inventory. `room_number` UNIQUE, `room_type`, `active`. |
| `room_rates` | Rate plans keyed by `(room_type, plan)`. |
| `rate_overrides` | Date-scoped exceptions. |
| `room_maintenance` | Out-of-service blocks. |

## Housekeeping & laundry

| Table | Purpose |
|---|---|
| `housekeeping_tasks` | Per-room daily tasks. `(booking_id, room_id, business_date)` UNIQUE. |
| `housekeeping_room_exceptions` | Ad-hoc HK deltas. |
| `hk_issue_types` | Master for HK issue reasons. |
| `linen_types` | Master for laundry linen. |
| `laundry_batches` | Batch header. |
| `laundry_batch_lines` | Per-linen line items. |
| `laundry_queue` | HK-completed items awaiting batching. |

## Cash Book

| Table | Purpose |
|---|---|
| `cash_transactions` | Cash-in/out entries. |
| `cash_tx_activities` [Log] | Change history. |
| `cash_audit_closes` | Daily close snapshots. |
| `cash_audit_activities` [Log] | Close history. |
| `expense_types` | Expense category master. |

## Night Audit

| Table | Purpose |
|---|---|
| `night_audit_runs` | Run header incl. status + duration. |
| `night_audit_sessions` | Immutable per-run ledger. |
| `night_audit_decisions` | Per-check outcomes. |

## Complaints

| Table | Purpose |
|---|---|
| `complaints` | Guest complaint header. |
| `complaint_activities` [Log] | Update history. |
| `complaint_categories` | Category master. |

## Charges & inventory

| Table | Purpose |
|---|---|
| `charge_catalog` | Master of add-on charges (menu items etc.). |
| `inventory_items` | Item master (F&B, supplies). |
| `inventory_movements` | Stock in/out. |
| `vendors` | Vendor master. |
| `tasks` | Generic operational tasks. |

## Staff / HR

| Table | Purpose |
|---|---|
| `staff` | Staff master. |
| `staff_attendance` | Daily attendance. |
| `salary_payments` | Salary disbursement. |
| `salary_advances` | Salary advance ledger. |
| `staff_documents` | HR docs (contracts, IDs). |

## CRM outbound

| Table | Purpose |
|---|---|
| `crm_outbound_emails` [Log] | Queued/sent emails. |

## Deprecated (dormant, read-only)

| Table | Note |
|---|---|
| `quotes` [Dep] | v0.x quotes header. Write grants revoked. |
| `quote_items` [Dep] | Line items. |
| `quote_activities` [Dep] | History. |
| `followups` [Dep] | Quote-scoped follow-ups. |

## RLS conventions

- **All public tables have RLS enabled.**
- Reads generally allowed to `authenticated` (business data is not
  per-user; the app is single-tenant).
- Writes typically gated by `has_role(auth.uid(), '<role>')` or
  `is_admin()`.
- Sensitive tables (`user_roles`, `user_permission_overrides`) block
  self-mutation via triggers + security-definer helpers.
- Public reads (`anon`) enabled only where required (Booking Engine
  availability queries, portal token verification).

## Security-definer helpers

| Function | Purpose |
|---|---|
| `has_role(_user_id, _role)` | Non-recursive role check. |
| `is_admin()` | Convenience wrapper for `owner`/`admin`. |
| `my_permissions()` | Effective permission set for `auth.uid()`. |
| `current_business_date()` | Reads `app_settings.business_date`. |
| `app_settings_guard_business_date` (trigger) | Prevents Business Date > calendar date. |
| `user_roles_block_legacy_role` (trigger) | Blocks writes of deprecated `reception`/`staff` roles. |

## Triggers

- `update_updated_at_column` on every table with `updated_at`.
- Table-specific audit triggers write to `activity_log`,
  `booking_activities`, `cash_tx_activities`, etc. Never bypass by
  writing directly to the audit tables.

## Indexes

Beyond primary keys, unique constraints, and FK indexes, hot paths
carry composite indexes:

- `bookings (business_date, status)`
- `booking_room_assignments (room_id, check_in, check_out)`
- `housekeeping_tasks (business_date, status)`
- `cash_transactions (business_date, tx_type)`
- `activity_log (entity_type, entity_id, created_at DESC)`

## Write paths

Never write directly to a table from a route. Always go through the
engine (`src/lib/*-api.ts` / `*.functions.ts`) responsible for the
entity. Engines are responsible for:

1. Input validation (Zod).
2. Business-rule enforcement.
3. Audit-log emission.
4. Cross-module event publication (activity rows).

## Read paths

Standard: engine wrapper → `supabase.from(...)`. Reporting queries use
`reporting/*.ts` helpers that centralize date-range handling and
Business-Date logic.
