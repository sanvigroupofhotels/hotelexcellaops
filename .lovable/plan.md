# Next Foundational Shipment

Four items, all building toward SaaS-readiness. Implemented in this order so each layer supports the next.

---

## 1. Cashbook Audit Close (Admin only)

**Database (new migration)**
- `cash_audit_closes` table:
  - `closed_through_date` (date) — all transactions on/before this date are locked
  - `closed_by`, `closed_by_name`, `closed_at`
  - `reopened_by`, `reopened_at`, `reopen_reason`, `active` (boolean)
- Helper: `is_cash_tx_locked(occurred_at)` SECURITY DEFINER — returns true if an active audit close covers that date.
- Modify `cash_transactions` UPDATE/DELETE RLS:
  - Admin: always allowed (after providing reopen flow at app layer)
  - Staff/Owner: blocked when `is_cash_tx_locked(occurred_at)` is true
- Activity logging through existing `cash_tx_activities` style: new table `cash_audit_activities` for: `audit_closed`, `audit_reopened`, `audit_closed_again`. Transaction edits on locked-then-reopened tx already log via existing `cashtx_audit` trigger.

**UI**
- `src/routes/_authenticated/cash.tsx`:
  - New "Audit Close" button (admin only) → dialog: pick date → confirm
  - "Audit History" panel showing closes with 🔒 / 🔓 chips and reopen reason
  - Each transaction row shows 🔒 Audited badge when locked; 🔓 Reopened when in a reopened window
  - Edit/Delete buttons disabled for non-admin on locked rows (tooltip: "Locked by audit close")
  - Admin Unlock dialog: mandatory reason → reopens (deactivates current close, logs `audit_reopened`)

---

## 2. Complete Master Data Reorganization

**Database**
- Existing `master_data` table already has `category` + `value` + `label` + `sort_order` + `active`. Reuse it.
- Seed migration: insert canonical entries for new categories — `room_category`, `room_status`, `block_reason`, `payment_mode`, `charge_category`, `expense_category`, `tax`, `issue_type`, `issue_priority`, `cancellation_reason`, `override_reason`, `complaint_status`, `whatsapp_template`, `invoice_footer`, `message_template`. (Templates use longer `label` content.)
- Migrate existing hardcoded values from `mock-data.ts` constants and `complaint_categories` / `expense_types` rows into `master_data` (keep originals for now; mark deprecated in next shipment).

**UI**
- Rebuild `src/routes/_authenticated/master-data.tsx` as a single tabbed module:
  - **General**: Lead Sources · Tags
  - **Rooms**: Room Categories · Room Statuses · Block Reasons
  - **Finance**: Payment Modes · Charge Categories · Expense Categories · GST/Taxes
  - **Operations**: Issue Types · Priorities · Cancellation Reasons · Override Reasons · Complaint Statuses
  - **Templates**: WhatsApp Templates · Invoice Footer · Message Templates
- Each tab: list with inline add/edit/toggle-active/reorder.
- Remove "Master Data" sub-tabs from Complaints/Issues, Cash (Expense Types), Rooms — those modules now consume `useMasterData(category)`.
- Replace hardcoded `LEAD_SOURCES`, `PET_RATES` labels, complaint categories list, expense type list reads with `useMasterData()` (falling back to current hardcoded as defaults).

---

## 3. Settings Page (Admin only)

**Database**
- Extend `app_settings` (key/value JSONB store already exists) — no schema change, just new keys:
  - `hotel.name`, `hotel.logo_url`, `hotel.address`, `hotel.gstin`, `hotel.phone`, `hotel.email`
  - `ops.check_in_time`, `ops.check_out_time`, `ops.currency`, `ops.timezone`
  - `branding.portal_title`, `branding.welcome_message`, `branding.invoice_footer`
- RLS: admin-only write; authenticated read.

**UI**
- New route `src/routes/_authenticated/settings.tsx` with tabs: General · Operations · Branding · Integrations.
- Wire existing "Settings" item in `user-menu.tsx` (currently inert) → `/settings`.
- Admin-only guard via `useRole`.

---

## 4. External Integrations Framework (foundation)

**Database**
- `integrations` table:
  - `name`, `provider` ("fabhotels" | "hotelzify" | "booking_com" | "agoda" | "razorpay" | "whatsapp" | custom)
  - `type` ("email_parser" | "api" | "webhook" | "csv_import")
  - `status` ("draft" | "connected" | "disabled" | "error")
  - `config` JSONB (provider-specific: email address, endpoint, secret ref, polling interval)
  - `last_sync_at`, `last_sync_status`, `last_sync_message`, `bookings_imported` (int)
- `integration_runs` table — one row per sync attempt: `integration_id`, `started_at`, `finished_at`, `status`, `message`, `created_count`, `updated_count`, `payload_excerpt`.
- `external_bookings` staging table — normalized inbound payloads before resolution: `integration_id`, `external_ref` (unique with integration_id), `raw_payload`, `parsed`, `booking_id` (nullable, set after match/create), `state` ("pending" | "linked" | "ignored" | "failed").
- Add `external_ref` and `integration_id` to `bookings` (already partially present as `external_booking_id` from prior backlog discussion — confirm and add if missing) for dedupe.

**Server endpoints (framework, no provider logic yet)**
- `createServerFn` group `src/lib/integrations.functions.ts`:
  - `listIntegrations`, `getIntegration`, `createIntegration`, `updateIntegration`, `disableIntegration`, `listIntegrationRuns`, `triggerSync(id)` (no-op dispatch stub).
- Generic dispatcher `src/lib/integrations/dispatch.server.ts` with a provider registry: `register(provider, { parse, fetchPending, normalize })`. Empty registry shipped now; FabHotels registers in next shipment.
- Normalization contract documented in code: `NormalizedBooking { external_ref, guest_name, phone, email, check_in, check_out, room_category, amount, advance_paid, source_status, raw }`. Common `upsertExternalBooking()` writes to `external_bookings` and creates/updates `bookings` via existing `bookings-api`.

**UI**
- `src/routes/_authenticated/settings.tsx` → Integrations tab:
  - List card per integration: name, type chip, status pill, last sync, bookings imported, Edit · Disable · Sync Now.
  - `+ Add Integration` dialog: Name → Type radio (Email Parser / API / Webhook / CSV Import) → Provider select → type-specific config form → Save (status=draft).
- Sub-route `src/routes/_authenticated/settings.integrations.$id.tsx`: config edit + recent runs table.

**Out of scope this shipment** (deferred to FabHotels shipment): Gmail OAuth, parser logic, pg_cron polling, webhook public route handlers. The framework's job here is the data model, server-fn surface, and admin UI.

---

## Technical Details

**Order of migrations**
1. `cash_audit_closes` + helper fn + RLS tightening
2. `master_data` seed for new categories
3. `integrations`, `integration_runs`, `external_bookings`, `bookings.external_ref/integration_id` (if absent)

All migrations include `GRANT` blocks per the public-schema rule; all new tables RLS-enabled (admin-write for `integrations`/`cash_audit_closes`; authenticated-read).

**Files (new)**
- `src/lib/cash-audit-api.ts`
- `src/lib/integrations-api.ts` + `src/lib/integrations.functions.ts` + `src/lib/integrations/dispatch.server.ts` + `src/lib/integrations/types.ts`
- `src/lib/app-settings-api.ts` (extend existing) for new setting keys
- `src/routes/_authenticated/settings.tsx`, `src/routes/_authenticated/settings.integrations.$id.tsx`
- `src/hooks/use-app-setting.ts`

**Files (modified)**
- `src/routes/_authenticated/master-data.tsx` (tabbed rebuild)
- `src/routes/_authenticated/cash.tsx` (audit close UI + locked badges + edit guard)
- `src/routes/_authenticated/complaints.tsx`, `complaints_.$id.tsx` (remove inline masters)
- `src/components/user-menu.tsx` (wire Settings link)
- `src/components/app-sidebar.tsx` (Settings entry, admin-only)
- Various consumers swap hardcoded arrays → `useMasterData()`

**Backlog after this shipment**
- FabHotels: Gmail OAuth + parser registered against the framework
- Quote Module Deprecation (Phase 2/3)
- Hotelzify provider on the same framework

---

Given the size, I'll ship in this order in a single batch but split into clearly-labeled commits so UAT can validate each piece independently. Shall I proceed?
