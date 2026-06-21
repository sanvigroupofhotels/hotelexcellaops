# CRM & Booking Engine Lead Capture — Approved Architecture (v2)

User approved on Jun 21, 2026 with modifications. This document supersedes v1.

---

## A. Approved decisions (deltas from v1)

| § | Decision |
|---|---|
| 9.1 | Booking Engine writes → public `createServerFn` using `supabaseAdmin`. No anon RLS. |
| 9.2 | Single CRM area inside `/customers` (tabs). No separate Leads nav. |
| 9.3 | Abandon timeout default = **10 min**. Configurable from Settings → CRM. |
| 9.4 | **Lost is automatic.** Rule: `status ∈ (Interested, Abandoned)` AND `current_date > check_out` AND no booking for same mobile → `Lost`. |
| 9.5 | Phase 1 = in-app activity + Email. WhatsApp = Phase 2. Notification dispatcher kept extensible. |
| 9.6 | Email notifications **in Phase 1**. Default recipient: `hotelexcellaoperations@gmail.com`. Additional emails configurable in Settings → CRM. |
| 9.7 | Repeat Guest = `completed_stays >= 2`. Cancelled / No-Show / Draft do **not** count. |

### Big modeling change (§B)
**ONE mobile → ONE lead row.** `leads.phone` is **UNIQUE**. Lifecycle history lives in `lead_activities`, not in multiple lead rows. When a guest returns, the existing lead is updated (status, dates, room_type, estimated_total, last_activity_at).

### Hard rule (§D)
`lead.phone == customer.phone == booking.phone` always. If staff changes booking.phone, re-link/create customer.

---

## 1. Schema (final)

### 1.1 `lead_status` enum
`Interested | Abandoned | Converted | Lost`

### 1.2 `public.leads`
```
id              uuid PK
user_id         uuid          -- audit owner
customer_id     uuid FK customers(id)   -- always set after first save
booking_id      uuid FK bookings(id)    -- latest booking for this lead

guest_name      text NOT NULL
phone           text NOT NULL UNIQUE    -- E.164, business key
email           text
check_in        date
check_out       date
adults          int
children        int
rooms           int
room_type_id    uuid
estimated_total numeric(12,2)

status          lead_status NOT NULL DEFAULT 'Interested'
source_channel  text NOT NULL DEFAULT 'BookingEngine'
lost_reason     text
notes           text

last_activity_at timestamptz NOT NULL DEFAULT now()
abandoned_at    timestamptz
converted_at    timestamptz
lost_at         timestamptz

created_at      timestamptz NOT NULL DEFAULT now()
updated_at      timestamptz NOT NULL DEFAULT now()
```
Indexes: `(phone) UNIQUE`, `(status)`, `(customer_id)`, `(booking_id)`, `(last_activity_at)`.

### 1.3 `public.lead_activities`
```
id, lead_id FK leads(id) ON DELETE CASCADE,
actor_id, actor_name, actor_role,
action ('created'|'updated'|'status_changed'|'converted'|'lost'|'reopened'|'note'|'notification_sent'),
field, old_value, new_value, summary,
created_at
```

### 1.4 `bookings` (additive)
- `lead_id uuid FK leads(id)` — back-link when a lead exists.

### 1.5 `customers` (additive)
- `first_lead_at timestamptz`
- `lead_count int NOT NULL DEFAULT 0` (denormalized for tabs)

### 1.6 `app_settings` key = `crm`
JSON `{ abandon_minutes:10, notify_reception_emails:["hotelexcellaoperations@gmail.com"], notify_owner_phones:[], notify_on_lead:true, notify_on_abandon:true, notify_on_lost:false }`.

### 1.7 Functions / triggers
- `leads_set_updated_at`
- `leads_link_or_create_customer` — on INSERT/UPDATE if customer_id null and phone present, match by phone else create. Also: when phone changes, re-link.
- `bookings_auto_convert_lead` — AFTER INSERT/UPDATE on bookings: if a lead exists for same phone in (Interested, Abandoned), set lead.status=Converted, lead.booking_id, lead.customer_id, converted_at=now(); stamp bookings.lead_id.
- `lead_activities_audit` — on lead INSERT/UPDATE writes activity rows for status changes & material field edits.
- `sweep_abandoned_leads()` SECURITY DEFINER — Interested AND last_activity_at < now() - abandon_minutes AND no current booking → Abandoned.
- `sweep_lost_leads()` SECURITY DEFINER — status ∈ (Interested, Abandoned) AND check_out IS NOT NULL AND check_out < current_date AND booking_id IS NULL → Lost.
- Recompute `customers.lead_count`, `first_lead_at` via lead-side trigger.

### 1.8 RLS / GRANTS
- `leads`: SELECT/INSERT/UPDATE/DELETE → authenticated; ALL → service_role. No anon. Booking-Engine writes use `supabaseAdmin`.
- `lead_activities`: SELECT → authenticated; INSERT via SECURITY DEFINER triggers.

---

## 2. Lead lifecycle (one row per mobile)

```
        (booking engine inquiry for new phone)
                       │
                       ▼
                 ┌───────────┐  10m inactivity   ┌───────────┐
                 │Interested │ ────────────────► │ Abandoned │
                 └─────┬─────┘                   └─────┬─────┘
                       │                               │
        booking same phone (any channel)               │
                       ▼                               ▼
                 ┌───────────┐                  past check_out + no booking
                 │ Converted │                         │
                 └─────┬─────┘                         ▼
                       │                          ┌───────┐
   new inquiry same phone (update, no new row)    │ Lost  │
                       ▼                          └───┬───┘
                  status ← Interested  ◄──────────────┘
                  (lead_activities records reopened)
```

Same row, lifetime audit in `lead_activities`. No multi-row history.

---

## 3-7. (unchanged from v1 except as noted in §A)

---

## 8. UI

```
/customers
├── All
├── Leads          (status in Interested/Abandoned)
├── Customers      (has ≥1 booking, completed_stays < 2)
├── Repeat Guests  (completed_stays ≥ 2)
└── Lost Leads     (status = Lost, no current open booking)
```
- `/customers/$id` profile: Overview · **Leads (lead_activities timeline)** · Bookings · Payments · Notes.
- `/settings/crm` (new): abandon timeout, notification recipients (emails/phones), toggles.

---

## H/I. House View + Business Date rules (Phase 1)

- House View always shows `business_date - 1` as the first column. Reason: previous-day actions remain visible until Night Audit closes.
- Business Date does NOT auto-advance at midnight. It moves only when Night Audit completes (existing `/api/public/night-audit` already does this — confirm no auto cron is bumping it).
- Every operational screen reads `business_date` from `app_settings`, not system date.

## J. House View → New Booking room pre-selection
- Click empty room → `/bookings/new?room_id=<id>&room_type_id=<id>` with room + room type pre-filled. Editable.

---

## Phase 1 deliverables

1. Migration (above schema, GRANTS, triggers, sweeps).
2. `pg_cron` jobs: `sweep_abandoned_leads()` every minute; `sweep_lost_leads()` daily 02:00 IST.
3. Booking Engine checkout: Step A (Name + Mobile required) → server fn `upsertLeadFromBookingEngine` → Step B reveals pricing.
4. `touchLead` server fn called on price view + payment click.
5. Auto-conversion trigger when any booking (PMS / BE / Hotelzify) inserts.
6. Customers route: tabs (All / Leads / Customers / Repeat Guests / Lost Leads), counts via SQL views.
7. Customer profile: Leads timeline (lead_activities).
8. Settings → CRM: timeout, reception emails (default `hotelexcellaoperations@gmail.com`), toggles.
9. Email notifications via existing Lovable email infra (template: lead created, lead abandoned). Includes name, mobile, room, check_in/out, quoted amount, open-lead URL.
10. House View: show business_date-1 as first column; click empty room navigates to /bookings/new with room_id pre-selected.
11. Confirm business_date advances only via night-audit endpoint (no other writer).

---

## Deep UAT (run before sign-off)

1. BE: new phone → Lead Interested → email to reception → pricing visible after Step A.
2. Same phone returns (Interested) → 10 min later → Abandoned → email.
3. Same phone completes Pay-at-Hotel → Converted, booking.lead_id set, customer.total_bookings++.
4. Reception creates PMS booking for phone with open Lead → auto-Converted (no button).
5. Lead Abandoned, check_out passes, no booking → next sweep marks Lost (logged in activity).
6. Lost lead's phone returns weeks later → **same row** reopens to Interested; activity timeline shows full history.
7. Walk-in (no lead): direct booking → no lead row, customer exists, appears under Customers tab.
8. Mobile collision: same phone, different name → customer name unchanged; lead.guest_name updates; activity logs the rename.
9. Booking phone edited → customer re-linked or created; lead phone stays its own UNIQUE key.
10. House View first column = business_date - 1; clicking room 203 opens new booking with 203 pre-selected.
11. Settings → CRM: change abandon_minutes to 5 → next stale Interested flips at 5 min.
12. Toggle notify_on_abandon=false → no email on abandon flip; activity row still recorded.
13. Two concurrent bookings same phone within seconds → exactly one Converted; second booking still gets lead_id.
14. Booking cancelled after conversion → lead stays Converted (history); customer counters re-derived.
15. Business date does not change at midnight. Only changes after night-audit run.

Implementation proceeds in this order: (1) Migration → (2) backend triggers/functions → (3) BE checkout Step A → (4) Customers tabs & profile timeline → (5) Settings → CRM → (6) Email sender → (7) House View tweaks → (8) Run UAT.
