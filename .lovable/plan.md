
# CRM & Booking Engine Lead Capture — Architecture Proposal

This is a design-only document. Nothing is implemented yet. Approve sections individually or as a whole; I'll then build in phases.

---

## 1. Database Schema Changes

### 1.1 New table: `leads`

```
leads
  id                uuid PK
  user_id           uuid                       -- owning tenant user (audit)
  customer_id       uuid  FK customers(id)     -- nullable; set when matched/created
  booking_id        uuid  FK bookings(id)      -- nullable; set on conversion

  -- Captured details
  guest_name        text  NOT NULL
  phone             text  NOT NULL             -- E.164 normalized, business key
  email             text  NULL
  check_in          date  NULL
  check_out         date  NULL
  adults            int   NULL
  children          int   NULL
  rooms             int   NULL
  room_type_id      uuid  NULL
  estimated_total   numeric(12,2) NULL         -- snapshot of quoted price

  -- Lifecycle
  status            lead_status NOT NULL DEFAULT 'Interested'
                    -- enum: Interested | Abandoned | Converted | Lost
  source_channel    text  NOT NULL DEFAULT 'BookingEngine'
                    -- BookingEngine | WhatsApp | Phone | Walk-In | OTA | Other
  lost_reason       text  NULL
  notes             text  NULL

  -- Activity tracking (drives Abandoned detection)
  last_activity_at  timestamptz NOT NULL DEFAULT now()
  abandoned_at      timestamptz NULL
  converted_at      timestamptz NULL
  lost_at           timestamptz NULL

  created_at        timestamptz NOT NULL DEFAULT now()
  updated_at        timestamptz NOT NULL DEFAULT now()

INDEXES:
  (phone), (status), (customer_id), (booking_id), (last_activity_at)
```

### 1.2 New enum: `lead_status`
`Interested`, `Abandoned`, `Converted`, `Lost`.

### 1.3 `bookings` — additive
- `lead_id uuid NULL FK leads(id)` — back-link when booking originated from a lead.
- Existing `source_channel` already supports `BookingEngine`.

### 1.4 `customers` — additive
- `first_lead_at timestamptz NULL` — when the customer first appeared as a lead.
- `lead_count int NOT NULL DEFAULT 0` — denormalized counter for the Customers UI.
- Re-use existing `lead_source` (do NOT overwrite when customer already exists — same rule as today).

### 1.5 New table: `lead_activities` (audit)

```
lead_activities
  id, lead_id, actor_id, actor_name, actor_role,
  action ('created'|'updated'|'status_changed'|'converted'|'lost'|'note'),
  field, old_value, new_value, summary, created_at
```

### 1.6 New table: `crm_settings` (single-row JSON, or rows in `app_settings`)
- `abandon_minutes int DEFAULT 10`
- `notify_owner_phones text[]`
- `notify_reception_emails text[]`
- `notify_on_lead boolean DEFAULT true`
- `notify_on_abandon boolean DEFAULT true`

(Will likely be stored as a single `app_settings` row `crm` to avoid a new table — calling it out for review.)

### 1.7 Triggers / functions
- `leads_set_updated_at` — standard.
- `leads_link_or_create_customer` — on INSERT/UPDATE, when `customer_id IS NULL` and `phone` set: match by phone, else create. Mirrors `link_or_create_customer` for bookings.
- `bookings_auto_convert_lead` — on INSERT of a booking with a phone that matches an open lead (Interested/Abandoned), set `booking.lead_id`, update `lead.status='Converted'`, `lead.booking_id`, `converted_at`.
- `leads_recompute_customer_counters` — keeps `customers.lead_count` / `first_lead_at`.
- `sweep_abandoned_leads()` SECURITY DEFINER — flips `Interested` → `Abandoned` when `last_activity_at < now() - abandon_minutes` AND no booking yet. Run via `pg_cron` every minute.

### 1.8 RLS / GRANTS
- `leads`: SELECT/INSERT/UPDATE/DELETE to `authenticated`; ALL to `service_role`. No anon. Booking-Engine writes go through a `createServerFn` using publishable-key client → policy must allow anon? **Decision needed (see §9 Q1).** Proposal: writes go through an unauthenticated server function using `supabaseAdmin` (server-side), so no anon grant needed.
- `lead_activities`: SELECT authenticated; INSERT via triggers (security definer).

---

## 2. Lead Lifecycle

```
                +-------------+
   create  -->  | Interested  |
                +------+------+
                       |
   no activity 10m     |    booking created (any channel, same phone)
        |              v
        v        +-----------+        +-----------+
   +---------+   | Converted |<-------|  Booking  |
   |Abandoned|-->+-----------+        +-----------+
   +----+----+         ^
        |              |  (manual: reception creates booking from lead)
        | reception marks lost / no response after N days
        v
   +-------+
   | Lost  |
   +---+---+
       |
       | new lead with same phone arrives later
       v
   new Interested lead (history preserved on customer)
```

Rules:
- `Interested → Abandoned`: automatic, sweep job, 10 min default (configurable).
- `Interested|Abandoned → Converted`: automatic when a booking is created with the same phone, OR explicit "Create Booking from Lead".
- `Interested|Abandoned → Lost`: manual only, with `lost_reason`.
- `Lost` is terminal for *that* lead row. A new inquiry from the same phone creates a NEW lead (linked to same customer).
- `Converted` is terminal.

---

## 3. Customer Lifecycle

```
  Booking Engine inquiry          Reception walk-in / call
          |                                  |
          v                                  v
       Lead (Interested) ----+         Customer (no Lead)
          |                  |               |
          | match/create     |               | booking created directly
          v                  |               v
       Customer  <-----------+         Customer (no Lead, has Bookings)
          |
          | booking created          
          v
       Customer + Booking (Converted Lead)
          |
          | >= 2 completed stays
          v
       Repeat Guest (derived, not a status column)
```

Key rules:
- Customer is the **canonical identity**. Lead and Booking both point at it.
- "Repeat Guest" is **derived**: `customers.total_bookings >= 2 AND last_stay_date IS NOT NULL` — no schema field needed.
- A Customer can exist without any Lead (legacy / direct bookings).
- A Customer can have many Leads (every inquiry is its own row; history shown on profile).

---

## 4. Booking Engine Flow (revised)

```
/booking-engine            -> dates + guests
/booking-engine/search     -> room type cards (no detailed price yet)
/booking-engine/checkout   -> NEW step layout:

   Step A: Contact details (REQUIRED first)
     Name *  | Mobile * (E.164) | Email (optional)
     [Continue]
        |
        | onSubmit -> server fn  createLeadFromBookingEngine({...})
        |   -> upsert lead by (phone, open-status)
        |   -> link/create customer
        |   -> set last_activity_at = now()
        |   -> fire notification (owner WA/SMS, reception email)
        |
        v
   Step B: Price summary visible
     Room, dates, nights, line items, taxes, total
     Pay Now (Razorpay)  |  Pay at Hotel
        |
        | any further activity -> updateLeadActivity(lead_id)
        v
   Booking created -> trigger flips lead.status = Converted
```

- Price is **revealed only after Step A**, satisfying the new requirement.
- Lead row exists *before* any payment intent or draft booking.
- Draft booking creation (existing flow) still works; it now also stamps `bookings.lead_id`.
- If guest abandons before pressing Pay Now / Pay at Hotel, the sweep job marks the lead `Abandoned` after 10 min.

### Abandonment detection
- Every interaction in checkout (price view, payment-option click) calls a tiny `touchLead` server fn updating `last_activity_at`.
- `sweep_abandoned_leads()` cron: `Interested AND last_activity_at < now() - interval '10 minutes' AND booking_id IS NULL` → `Abandoned`.

### Notifications
- Triggered server-side (not client) so closing the browser doesn't matter:
  - On lead create → optional WhatsApp/SMS to Owner, Email to Reception.
  - On `Abandoned` flip → same recipients, different template.
- Recipients configurable in **Settings → CRM → Notifications**.
- Phase 1: log to a `lead_notifications` table + email via existing mailer; WhatsApp via existing integration if present, else stub with TODO.

---

## 5. Lead → Booking Flow

Reception opens a Lead → **[Create Booking from Lead]** button:
1. Navigates to `/bookings/new?lead_id=<id>` with pre-filled:
   - guest_name, phone, email
   - check_in, check_out, adults, children, rooms, room_type
   - source_channel = `Lead` (or original source preserved)
2. Reception completes the rest (room assignment, payment, etc.) as today.
3. On booking insert:
   - trigger sets `lead.status = 'Converted'`, `lead.booking_id`, `converted_at`.
   - `link_or_create_customer` (existing) ensures customer link.
   - `bookings.lead_id` stamped.

Auto conversion also works when reception creates a booking *without* using the button — phone match converts the open lead automatically.

---

## 6. Cross-linking Rules — explicit cases

| Case | Customer | Lead | Booking | Behavior |
|---|---|---|---|---|
| Customer without Lead | ✓ | – | optional | Legacy / walk-in. Untouched. |
| Booking without Lead | ✓ | – | ✓ | Direct booking. `bookings.lead_id` null. Allowed. |
| Lead without Booking | ✓ | ✓ | – | Inquiry only. Stays `Interested`/`Abandoned`/`Lost`. |
| Lead → Customer → Booking | ✓ | ✓ | ✓ | Standard funnel. Auto-converts. |
| Lost Lead → Converted later | ✓ | Lost (old) + new lead | ✓ | New lead row, same customer; old `Lost` preserved for history. Booking links to the new lead. |
| Mobile collision (two different names, same phone) | ✓ (1) | ✓ (n) | ✓ | Customer matched by phone (existing behaviour). Lead keeps captured `guest_name` for record; customer name not overwritten. Reception sees both names in lead history. |

**Mobile number is the business key** for all matching:
- Normalize to E.164 on write (`src/lib/phone.ts` exists).
- `customers.phone` already enforces uniqueness via the existing `link_or_create_customer` matching.
- `leads.phone` is NOT unique (one customer can have many leads).

---

## 7. Notifications

| Event | Channel(s) | Default Recipient | Configurable? |
|---|---|---|---|
| Lead created (BookingEngine) | WhatsApp/SMS, Email | Owner phones, Reception emails | Yes |
| Lead abandoned | WhatsApp/SMS, Email | Owner phones, Reception emails | Yes |
| Lead converted | (silent, in-app activity) | — | — |
| Lead marked Lost | in-app activity | — | — |

Settings → CRM page:
- multi-input phone list (Owner)
- multi-input email list (Reception)
- toggles per event
- abandon timeout (minutes)

---

## 8. UI Structure

### `/customers` becomes a tabbed shell

```
Customers
├── All           (everyone: leads + customers + repeat — search across)
├── Leads         (status in Interested/Abandoned, sub-filter)
├── Customers     (has >= 1 booking, not repeat)
├── Repeat Guests (total_bookings >= 2)
└── Lost Leads    (status = Lost; no active booking)
```

Each row links to the unified `customers/$id` profile, which now has sections:
- Overview (contact, lead_source, totals)
- Leads (lead_activities timeline)
- Bookings (existing)
- Payments / Dues (existing)
- Notes

### Cross-navigation
- Lead row → "Open Customer" + "Open Latest Booking" (if any).
- Booking detail → "Originating Lead" link when `lead_id` set.
- House View room click → opens `/bookings/new?room_id=<id>` with pre-selected room (separate small change — calling out as part of this shipment).

### New routes
- `/_authenticated/leads.tsx` — list (or merge into customers tabs; proposal: **merge** for simplicity, single Customers shell).
- `/_authenticated/customers_.$id.tsx` — extend existing.
- `/_authenticated/settings.crm.tsx` — notification config.

---

## 9. Open Questions for Approval

1. **Booking-Engine write path** — confirm: lead creation runs via a public `createServerFn` using `supabaseAdmin` (no anon RLS surface). ✅ recommended.
2. **Leads as separate top-level nav?** — proposal: **no**, keep inside Customers tabs (less nav clutter). Confirm.
3. **Abandon timeout default 10 min** — confirm or pick another value.
4. **Lost auto-rule?** — should `Abandoned` auto-flip to `Lost` after e.g. 7 days, or stay manual? Proposal: **manual only** in Phase 1.
5. **WhatsApp provider** — use existing integration (Hotelzify? Twilio? other) or stub? Please confirm what's already wired.
6. **Email sender** — reuse existing transactional sender? (Need to confirm one exists.)
7. **Repeat guest threshold** — `total_bookings >= 2` OR `>= 2 completed stays`? Proposal: completed stays.

---

## 10. Deep UAT Scenarios (to run before sign-off)

1. New guest enters name+mobile → Lead `Interested`, customer created, owner gets WA, reception gets email, price visible.
2. Same guest abandons → 10 min later status = `Abandoned`, second notification sent.
3. Same guest returns, completes Pay-at-Hotel → lead auto-converts, booking has `lead_id`, customer `total_bookings` +1.
4. Reception creates booking from Abandoned lead via button → prefill correct, auto-converts on save.
5. Reception creates booking via PMS for a phone that has an open lead → lead auto-converts (no button used).
6. Mark lead `Lost` with reason → appears in Lost Leads tab, customer profile shows it in history.
7. Lost lead's phone returns weeks later → new `Interested` lead row, same customer, old Lost preserved.
8. Existing customer (no prior lead) walks in → direct booking, no lead row created. Customer tab still shows them.
9. Same phone, different name in inquiry vs walk-in → customer name unchanged; lead retains inquiry name; activity log shows both.
10. House View → click empty room → `/bookings/new?room_id=…` opens with room pre-selected and room_type derived.
11. Settings → CRM: change owner phones / reception emails / toggles → next event uses new config.
12. Disable both notification toggles → events still record activity but no outbound message.
13. Sweep job downtime: bring it back, multiple stale Interested leads flip to Abandoned in one pass.
14. Concurrency: two booking inserts for same phone within seconds — only one lead conversion wins, no duplicate.
15. Booking cancelled after conversion → lead stays `Converted` (historical); customer counters re-computed by existing trigger.

---

## 11. Phasing (proposed)

- **Phase 1**: schema + triggers + sweep cron + Booking Engine Step A + auto-conversion + Customer tabs + Lead activity log. (No external notifications yet — in-app only.)
- **Phase 2**: Settings → CRM + WhatsApp/Email notifications wired.
- **Phase 3**: House View pre-select room + Lead-to-Booking deep prefill polish + reports (funnel: Leads → Converted → Revenue).

---

Please review and confirm:
- §1 schema shape
- §2/§3 lifecycle rules
- §6 cross-linking table (especially Lost → new lead behavior)
- §8 Customers tabs (vs separate Leads nav)
- §9 open questions (1–7)

Once approved I'll implement Phase 1 end-to-end and run the §10 UAT before handing back.
