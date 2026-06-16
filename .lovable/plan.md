# Hotel Excella PMS — Active Backlog

Goal: Operationally perfect PMS for Hotel Excella today, gradually evolving towards Multi-tenant Hotel PMS SaaS tomorrow.

## ✅ Shipped this turn
- **Global readability typography** — `.stat-num`, `.stat-num-lg`, `.stat-num-xl`, `.tabular` utilities in `src/styles.css`; all `<td>`/`<th>` now use tabular-nums globally.
- **House View Search** — top search bar (guest name / mobile / booking ID), inline dropdown of matches, scroll-to + highlight pulse, header row shows Today's date.
- **Cancellation Refund Workflow** — Cancel dialog collects refund amount + mode + collected-by; writes a `booking_payments` row with `is_refund=true`; advance recompute trigger subtracts refunds; cash sync trigger writes a cashbook expense for Cash refunds; activity log entry includes reason + refund.

## 1. FabHotels Gmail Email Parser (next shipment — needs Google Cloud setup)

**Architecture chosen by Shobhan:** Gmail API via OAuth2, all code in repo (no Lovable-only deps), real-time via Gmail Push (Pub/Sub watch). Should remain portable to GitHub / self-host.

**Required inputs from Hotel Excella before implementation:**
1. **Google Cloud project** for Hotel Excella Operations
   - Enable: **Gmail API**, **Cloud Pub/Sub API**
   - OAuth consent screen → External → add `hotelexcellaoperations@gmail.com` as test user, scope `https://www.googleapis.com/auth/gmail.readonly` (+ `gmail.modify` only if we want to label/archive parsed emails)
2. **OAuth 2.0 Client (Web application)** → secrets to add later:
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
   - Authorized redirect URI: `https://ops.hotelexcella.in/api/public/gmail-oauth-callback`
3. **Cloud Pub/Sub topic** e.g. `projects/<your-gcp-project>/topics/gmail-fabhotels`
   - Grant `gmail-api-push@system.gserviceaccount.com` the `Pub/Sub Publisher` role on the topic
   - Push subscription → endpoint `https://ops.hotelexcella.in/api/public/gmail-push`
4. **One-time OAuth consent** by hotelexcellaoperations@gmail.com → we'll store the long-lived refresh_token as `GMAIL_REFRESH_TOKEN`.
5. **Sample FabHotels emails** (2–3 anonymized samples) so the parser regex/structured-text mapping is built against real format.

**Implementation plan (once secrets are in place):**
- TanStack server route `/api/public/gmail-push` verifies push JWT, fetches new messages, parses FabHotels emails, upserts booking by `(source='FabHotels', external_booking_id)`.
- Schema additions: `bookings.source`, `bookings.external_booking_id`, `bookings.gmail_message_id`, `bookings.raw_email`, `bookings.parsed_at`, unique `(source, external_booking_id)`.
- Daily `users.watch()` renewal via a `/api/public/gmail-renew-watch` route called by pg_cron.
- Activity log: `"Booking Imported from FabHotels"`.

## 2. Cashbook Audit Close (Admin only)
- Cashbook → Audit Close → select date → Confirm. Lock transactions up to that date.
- After close: no edit/delete for Staff/Owner. Admin can Unlock with mandatory reason → Edit → Audit Close again.
- Show 🔒 Audited badge on locked rows.
- Activity logs: Audit Closed, Audit Reopened, Transaction Edited, Audit Closed Again.

## 3. Master Data Reorganization
Move hardcoded values into master data:
- Room Categories, Charge Categories, Expense Categories
- Payment Modes, Issue Types, Taxes
- Cancellation Reasons, Hotel Settings, Templates

## 4. Hotelzify API / Webhook Integration
If APIs/webhooks available: Hotelzify → API/Webhook → PMS → Create/Update Booking. Reuses the External Booking Source schema introduced for FabHotels.

### Common External Booking Source requirements
Store on booking: `source`, `external_booking_id`, `gmail_message_id`, `raw_email`, `parsed_at`.
Prevent duplicate imports. Activity log: "Booking Imported from {source}".
Long-term: generic External Booking Sources framework supporting Gmail parser, APIs, Webhooks, CSV imports.

## 5. Quote Module Deprecation
- **Phase 1 (now)**: Remove Quote entry points from Home and Quick Actions. ✅
- **Phase 2**: Hotel Settings → "Enable Quotes" toggle, default OFF.
- **Phase 3**: Freeze Quote features; archive if unused.

---

## Removed from backlog
- Cashbook Day Close — replaced by Cashbook Audit Close.
- Hyberto — replaced by FabHotels + Hotelzify.
