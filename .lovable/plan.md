## Backlog Consolidation — Review & Architecture Proposal

This shipment is split into **Quick Wins** (safe to ship now in one pass) and **Phased Architecture** (needs your sign-off before code). Nothing is implemented in this turn — confirm scope and I'll execute.

---

### 1. House View — Chip Border Logic  *(Quick Win)*

**Current**: `blockClasses(status)` keys color purely off `b.status`. Blue only when status is `Advance Paid` / `Full Paid`.

**Findings**:
- `bookings.pay_at_hotel: boolean` already exists on the row (confirmed in `types.ts:484`).
- A confirmed Pay-at-Hotel booking today renders as **grey** (Pending/Confirmed bucket) — visually indistinguishable from an un-committed draft.

**Proposal** — change signature to `blockClasses(b)` and apply:
```
Blue   = status ∈ {Advance Paid, Full Paid, Confirmed}
         AND (advance_paid > 0 OR pay_at_hotel = true)
Grey   = status ∈ {Pending, Confirmed} AND not blue
Green  = Checked-In
Slate  = Checked-Out / Stay Completed
Red    = Cancelled / No-Show
```
Update the legend label from "Advance / Full Paid" → **"Confirmed & Committed"**. Existing 💳 due icon stays as-is, so OPS can still spot "Pay-at-Hotel, not yet collected" at a glance.

Scope: ~15 lines in `src/routes/_authenticated/house-view.tsx`. No DB change.

---

### 2. House View — Mobile Drag & Drop  *(Architecture)*

**Findings**:
- Current implementation uses HTML5 `draggable` + `dataTransfer`. On iOS Safari and Android Chrome, HTML5 DnD on touch is **non-standard** — no native long-press-to-drag, no auto-scroll, no drop highlight. We've inherited a known-flaky API.
- A real touch-DnD layer would mean adopting `@dnd-kit/core` (~12 KB) or hand-rolling pointer events with auto-scroll. Both are non-trivial and still fragile on a horizontally-scrolling timetable.

**Recommendation: Mobile-only fallback dialog. Keep HTML5 DnD on desktop only.**

Detection: `useMobile()` (already in `src/hooks/use-mobile.tsx`).

Mobile UX:
- Long-press (≥500ms) on a pill → haptic tick → opens **Move Booking** dialog.
- Dialog fields: Room (select from same category, with vacancy check), Check-In Date, Check-Out Date, derived Nights.
- Reuses the same server-side mutation that desktop DnD calls today (date-delta logic in `house-view.tsx`).
- On submit: optimistic update + toast + rollback on conflict (already implemented for DnD).

Why fallback > native touch DnD:
- Reliability across iOS/Android, no edge cases with momentum-scroll.
- Same UX on phones used at reception desks.
- Reuses existing date-shift + room-reassign code path — single source of truth.

Desktop unchanged.

---

### 3. Booking Engine Review Page — Back-Nav & Edit  *(Architecture)*

**Current flow**: `search` → `checkout` (creates booking row + guest info + documents) → `review`. The `booking_id` is the row in `bookings`; `review` only reads pricing. Going back today loses guest details because we re-mount `checkout` with empty form state.

**Findings**:
- `bookings` row exists at review time. Guest name, email, phone, documents are persisted.
- Dates/room category are columns on the booking row. We just don't have UI to mutate them from review.

**Proposal**:

1. **Persist-and-rehydrate** rather than client-side state preservation:
   - `checkout` already writes to `bookings`. Pre-fill the form from `bookings` when `?booking_id=` is in the URL.
   - Back button on Review goes to `/booking-engine/checkout?booking_id=…` (not /search), so guest details + docs survive a round-trip.

2. **Inline "Modify Stay" panel** on Review (collapsed by default):
   - Date pickers + room category select.
   - On change → call a new server fn `updateDraftStay({ booking_id, check_in, check_out, room_type })` which:
     - Validates the new room category has inventory for the new date range,
     - Re-prices via existing `getDraftPricing`,
     - Updates the `bookings` row (still `Draft` status).
   - Pricing card auto-refreshes via React Query invalidation on `["be","review",booking_id]`.

3. **Server fn**: extend existing `booking-engine.functions.ts`. No new tables. RLS: keep public-anon insert/update scoped to `Draft` bookings only (already the case).

Scope: medium (~1 day). Touches `booking-engine.checkout.tsx`, `booking-engine.review.tsx`, `booking-engine.functions.ts`. No schema change.

---

### 4. Audit History — Move under End of Day  *(Quick Win — Reuse)*

**Current**: `/_authenticated/reporting/night-audit` (`reporting.night-audit.tsx`). Columns: Business Date, Advanced To, Run At, Triggered By, Mode, CI/CO Resolved, Status.

**Gap vs. your spec**:
| You asked for         | Today |
|-----------------------|-------|
| Business Date         | ✅ |
| Performed By          | ✅ (Triggered By) |
| Performed At          | ✅ (Run At) |
| Occupancy %           | ❌ — not stored on `night_audit_runs` |
| Revenue               | ❌ |
| Collections           | ❌ |
| Outstanding Dues      | ❌ |
| Open → EOD Report     | ❌ |
| Print / Download PDF  | ❌ (EOD Report has it; History does not) |

**Proposal — reuse with fine-tuning, no new page**:

1. **Move route**: rename to `night-audit.history.tsx` so the URL becomes `/end-of-day/history`. Add sidebar entry "Audit History" under End of Day group in `app-sidebar.tsx`. Leave the old `reporting/night-audit` as a redirect for one release.

2. **Enrich columns** by joining to a snapshot:
   - Either (a) add 4 columns to `night_audit_runs` (`occupancy_pct`, `room_revenue`, `collections`, `outstanding_dues`) populated at audit time inside `perform-night-audit.ts`, or
   - (b) compute on-the-fly per row using a `night_audit_snapshot(business_date)` server fn that mirrors EOD Report's queries.
   
   Recommend **(a)** — cheaper at list time, immutable historical record, and `perform-night-audit.ts` already gathers these numbers.

3. **Row click → opens EOD Report** for that business date. `night-audit.eod-report.tsx` already accepts a date param; just add `?date=YYYY-MM-DD` reuse.

4. **Print / Download PDF**: EOD Report already implements these. History page only needs the row-link; no duplication.

Migration: 1 small `ALTER TABLE night_audit_runs ADD COLUMN …` + backfill from existing snapshots where possible (or leave NULL for legacy rows, render "—").

---

### 5. Analytics Page — Full Overhaul  *(Architecture)*

**Current (`analytics.tsx`)**: Conversion %, Revenue (Booked from quotes), Pipeline, AOV, Repeat Guests, Total Customers, Total Quotes, Confirmed; Funnel; Lead Sources; Best Performing Rooms.

**Problems**:
- Every metric derives from `quotes`, not `bookings` / `booking_payments`. A directly-walked-in guest never has a quote — they're invisible here. This is a **CRM** dashboard, not a hotel dashboard.
- Funnel mixes quote statuses (Sent/Negotiation) with booking outcome (Confirmed). Confusing.
- "Revenue (Booked)" double-counts vs Reports/Payments because it sums `quotes.total`, not actual collected money.

**Proposal — split into two pages**:

#### A. **Owner Dashboard** (rename `analytics` → `owner-dashboard`, admin-only)
Source of truth: `bookings`, `booking_room_assignments`, `booking_payments`, `rooms`.

KPI strip (with day / MTD / YTD toggle):
- Occupancy %  =  `room_nights_sold / (total_rooms × days_in_period)`
- ADR  =  `room_revenue / room_nights_sold`
- RevPAR  =  `room_revenue / (total_rooms × days_in_period)`  *(= ADR × Occupancy %)*
- Rooms Sold (room-nights)
- Room Revenue
- Collections (sum of `booking_payments.amount` in period, all modes)
- Outstanding Dues (∑ `amount − advance_paid` for active bookings)
- ALOS — Average Length of Stay  =  `room_nights / unique_bookings`
- Cancellation %  =  cancelled / (cancelled + completed + active)
- No-Show %
- Repeat Guests %  (kept — already correct from `customers.total_bookings`)
- Direct vs OTA mix (needs `bookings.source` taxonomy — see Tech Debt)

Charts:
- Revenue trend (line, last 30 / 90 days)
- Occupancy trend (line, same period)
- Source mix (donut: Direct, Booking Engine, OTA, Walk-in, Phone)
- Top rooms by RevPAR (bar)

#### B. **Sales / CRM Analytics** (move existing analytics here, link from CRM)
Keep conversion %, pipeline forecast, lead source breakdown, quote funnel. Honest scope: "What's happening to my quotes?" not "How is my hotel doing?"

Effort: medium-large. Each KPI needs an aggregator server fn with date-range arg. Recommend building shared `kpi-aggregator.functions.ts` so EOD Report, Owner Dashboard, and Audit History all consume the same numbers (eliminates the reconciliation risk you flagged in §6).

---

### 6. ARR / Revenue Metrics — Definitions  *(Architecture)*

Industry standard (locked into one definitions file, e.g. `src/lib/kpi-defs.ts`, exported and referenced by every place that displays these):

| Metric | Formula | Notes |
|---|---|---|
| **Room Revenue** | ∑ `booking_charges` where `kind = 'room'` for the period | Excludes F&B, services, taxes. |
| **Total Revenue** | ∑ all `booking_charges` for the period | Includes everything billable. |
| **Collections** | ∑ `booking_payments.amount` where `paid_at ∈ period` | Cash + UPI + card + online. |
| **Rooms Sold** | Count of `booking_room_assignments` rows × nights overlapping the period | Room-nights. |
| **Rooms Available** | `rooms.count(active) × days_in_period` | Excludes blocked/maintenance days. |
| **ADR** | Room Revenue / Rooms Sold | ₹/room-night. |
| **RevPAR** | Room Revenue / Rooms Available | ₹/available-room-night. Equivalent: ADR × Occupancy. |
| **Occupancy %** | Rooms Sold / Rooms Available × 100 | |
| **ALOS** | Rooms Sold / Distinct Bookings | nights/booking. |

**On "ARR"**: "Average Room Revenue" is not a standard industry term and is easily confused with ADR. Recommend we **drop "ARR" from the PMS vocabulary** and use ADR / RevPAR / Room Revenue only. If you specifically need a separate "revenue per booking" number, call it **AOV (Average Booking Value)** — already used in current analytics.

Reconciliation: every page that shows any of these calls the same aggregator. EOD Report, Owner Dashboard, Audit History all read from `kpi-aggregator.functions.ts` → ensures the number a guest sees on their invoice rolls up to the same Total Revenue the owner sees on the dashboard.

---

### 7. Deep Operational Review — Tech Debt & Simplification

**Redundancies / debt**:
- `reporting.tsx`, `reporting.payments.tsx`, `reporting.staff.tsx`, `payments-reports.tsx`, `cash.tsx`, `dues.tsx` — overlapping financial views. Recommend consolidating into one **Reports** hub with tabs: Payments, Cash, Dues, Staff. Today there are 5–6 entry points for adjacent data.
- `quotes` vs `bookings` overlap: a confirmed quote becomes a booking, but quote rows remain canonical for CRM. The Analytics page above conflates the two — fixing it via §5 also clarifies the data model.
- `bookings.source` field is free-text-ish. Without a controlled enum (`direct | booking_engine | ota_makemytrip | ota_booking_com | walk_in | phone | whatsapp`) the "OTA vs Direct" KPI is unbuildable. Recommend a CHECK constraint + migration to normalize legacy values.
- `external_bookings` table is only used by Hotelzify polling. If no other channel manager is planned, fold it into `bookings.source = 'ota_*'` + `bookings.external_ref` and retire the table.
- `night_audit_runs` vs `night_audit_sessions` vs `night_audit_decisions` — three tables for one workflow. After §4 lands, audit whether `night_audit_sessions` is still needed or can be merged.

**Workflows that feel incomplete**:
- **Refunds**: We record payments but there's no first-class refund flow on cancellation. Today it's done as a negative cash transaction. Needs proper `booking_payments.kind = 'refund'` + a Refund dialog.
- **Folio / Bill print**: Booking detail has invoice dialog, but no consolidated folio at checkout time. Reception likely prints from invoice + manual cash receipt.
- **Channel manager**: Only Hotelzify is integrated. If OTAs are part of the roadmap, the integration shape (`integrations` + `integration_runs`) is in place but unused.

**Screens worth redesigning**:
- `reporting.tsx` is a stub index — replace with the consolidated Reports hub above.
- `analytics.tsx` — §5 above.
- Sidebar has grown long; the End-of-Day group injection in `app-sidebar.tsx` works but the overall IA could use a pass once Reports is consolidated.

**Opportunities to simplify**:
- Single KPI aggregator (§5/§6) eliminates 4 places that compute revenue today.
- One Reports hub eliminates 4–5 sidebar entries.
- Drop "ARR" terminology.
- Retire `external_bookings` if no second OTA is planned.

---

### Recommended Shipment Order

**Phase 1 — Quick Wins (one pass, ~½ day)**
- §1 House View chip blue for Pay-at-Hotel.
- §4a Move Audit History under End of Day (route + sidebar only; enrich columns in Phase 2).
- §7 Drop "ARR" wording from any current UI labels.

**Phase 2 — Architecture (sign-off needed, ~2–3 days)**
- §6 `kpi-aggregator.functions.ts` + locked definitions file. (Foundation.)
- §4b Enrich `night_audit_runs` with occupancy/revenue/collections/dues + row-click to EOD Report.
- §2 Mobile Move-Booking dialog fallback.
- §3 BE Review back-nav + inline Modify Stay.

**Phase 3 — Larger Refactor (separate shipment)**
- §5 Owner Dashboard vs CRM Analytics split.
- §7 Reports hub consolidation, `bookings.source` enum migration, retire `external_bookings`.

---

### Confirmations I need before coding

1. OK to ship **Phase 1** immediately in the next turn?
2. For §3, OK with **persist-on-checkout + back-nav rehydrate** (no client state machine)?
3. For §5, OK to **rename `analytics` → `owner-dashboard`** and move quote-based analytics to a new `crm-analytics` page?
4. For §6, OK to **drop "ARR"** entirely and standardize on ADR / RevPAR / Room Revenue / AOV?
5. For §2, OK with **mobile = dialog fallback** (no touch DnD library)?