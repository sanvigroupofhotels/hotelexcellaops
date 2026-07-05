# Phase 3B — Laundry Module Design (v2, operationally refined)

Supersedes v1. All ten refinements incorporated. The workflow now mirrors  
the real Excella process: HEOS proposes, the physical count with the vendor  
decides, and the vendor slip stays authoritative for billing.

---

## 0. Guiding Shift From v1

v1 treated "queue counts" as truth and reconciled shortages on return. In  
reality:

- The **HEOS queue is a suggestion.** The **vendor slip** (physical count  
at pickup) is the authoritative record.
- In-house washing is not a workflow — it is the natural residual of  
"queue minus what left the building". Never a user input.
- Slip numbers, slip photos, and monthly totals per vendor are billing  
artefacts and must be first-class.

Consequence: the send-time screen becomes the most important screen in the  
module. The return screen just closes the loop against the slip.

---

## 1. Revised End-to-End Workflow

```text
Housekeeping tasks completed
        │
        ▼
laundry_queue rows (queued)  ── HEOS suggestion, roll-forward
        │
        │  Staff opens Laundry → "New Pickup"
        │  Screen shows, per linen type:
        │    • HEOS Queue Count   (calculated, read-only)
        │    • Previous Missing   (short from prior batches, read-only)
        │    • Sent to Vendor     (editable → default = HEOS Queue)
        │  Optional: vendor slip #, pickup slip photo, pickup remarks
        │  Tap "Confirm Pickup"
        ▼
laundry_batches (state = sent)
  + laundry_batch_lines (per linen type: qty_heos_queue, qty_sent)
  + linked laundry_queue rows: state = sent, batch_id set
  + in-house residual computed on read (qty_heos_queue − qty_sent)
        │
        │  Vendor returns bag (next day / two days later)
        │  Staff opens the batch → Return screen
        │  For each linen type: OK / Short / Damaged / Lost (defaults OK = qty_sent)
        │  Optional: return photo, return remarks
        │  Tap "Confirm Return"
        ▼
laundry_batches (state = returned)
  + queue rows: state = returned  (OK + damaged + lost)
  + short rows: DETACHED — batch_id = NULL, state = queued
                → appear as "Previous Missing" in the next pickup
```

The **entire lifecycle is two taps**: Confirm Pickup, Confirm Return.

---

## 2. Send-Time Screen (the critical UX)

```text
┌───────────────────────────────────────────────────────────────┐
│  New Pickup — LB-20260705-001                                 │
│  Vendor: [ We Wash Laundry ▾ ]        Oldest queued: 3 days ⚠│
├───────────────────────────────────────────────────────────────┤
│ Linen Type      HEOS Queue   Prev Missing   Sent to Vendor    │
│                                                                │
│ Bedsheet             24            2            [  23  ]      │
│ Pillow Cover         46            1            [  47  ]      │
│ Towel                18            0            [  18  ]      │
│ Bath Mat              6            0            [   6  ]      │
├───────────────────────────────────────────────────────────────┤
│ Vendor Slip #:  [           ]                                 │
│ Pickup Slip Photo:  [ 📷 Upload ]                             │
│ Pickup Remarks:  [                            ]               │
│                                                                │
│                              [ Confirm Pickup ]               │
└───────────────────────────────────────────────────────────────┘
```

Rules:

- **HEOS Queue** = SUM of currently queued rows for that linen type.  
Non-editable. Live counter.
- **Prev Missing** = SUM of short-returned queue rows from earlier batches  
(§4). Non-editable. Included in HEOS Queue by construction (they were  
already `queued` again) — but broken out visually so staff know why the  
number is above today's HK output.
- **Sent to Vendor** = editable numeric, defaults to HEOS Queue value.  
This becomes the official quantity. Zero is allowed (rare but legal —  
in-house full wash day).
- **Oldest queued warning** — if any queued row is > 2 business_days old,  
banner shows "Oldest Pending Pickup: N days" (§10).
- **In-house Washed** is NEVER shown as an input. It is computed  
post-save as `qty_heos_queue − qty_sent` (per line and per batch).
- Multi-vendor is naturally supported: switching vendor doesn't change  
numbers; it just labels the batch.

---

## 3. Return Screen (unchanged from v1 except photo + remark split)

```text
┌───────────────────────────────────────────────────────────────┐
│  Return — LB-20260705-001 · We Wash Laundry                   │
│  Sent 05 Jul · 94 pieces · slip #WW-4471                      │
├───────────────────────────────────────────────────────────────┤
│ Linen Type       Sent    OK      Short   Damaged   Lost       │
│ Bedsheet           23   [23]     [ 0 ]    [ 0 ]    [ 0 ]      │
│ Pillow Cover       47   [45]     [ 2 ]    [ 0 ]    [ 0 ]      │
│ Towel              18   [17]     [ 0 ]    [ 1 ]    [ 0 ]      │
│ Bath Mat            6   [ 6]     [ 0 ]    [ 0 ]    [ 0 ]      │
├───────────────────────────────────────────────────────────────┤
│ Return Photo: [ 📷 Upload ]                                   │
│ Return Remarks: [                              ]              │
│                                                                │
│                              [ Confirm Return ]               │
└───────────────────────────────────────────────────────────────┘
```

`OK` defaults to `qty_sent` so the "everything came back" case is a single  
tap. Invariant enforced: `qty_sent = OK + Short + Damaged + Lost`.

---

## 4. Data Model (revised)

```text
laundry_batches
├── id                       uuid PK
├── batch_number             text UNIQUE   e.g. "LB-20260705-001"
├── vendor_id                uuid → vendors(id)
├── vendor_name_at_time      text
├── state                    enum(sent, returned, cancelled)
├── business_date            date
├── vendor_slip_number       text                           -- optional §6
├── pickup_slip_photo_path   text                           -- storage key §6
├── return_photo_path        text                           -- storage key §7
├── pickup_remarks           text                           -- §8
├── return_remarks           text                           -- §8
├── sent_at                  timestamptz
├── sent_by_user_id / name   (useCurrentStaff snapshot)
├── returned_at              timestamptz
├── returned_by_user_id / name
├── correlation_id           uuid
├── created_at / updated_at
└── (future) invoice_id      uuid → laundry_invoices(id)   -- §9

laundry_batch_lines           -- per linen type on a batch
├── id                       uuid PK
├── batch_id                 uuid → laundry_batches
├── linen_type_id            uuid → linen_types
├── linen_name_at_time       text
├── qty_heos_queue           int   NOT NULL   -- system count at send time
├── qty_sent                 int   NOT NULL   -- physical count (editable at send)
├── qty_returned_ok          int   DEFAULT 0
├── qty_short                int   DEFAULT 0
├── qty_damaged              int   DEFAULT 0
├── qty_lost                 int   DEFAULT 0
├── qty_in_house              generated: qty_heos_queue − qty_sent    -- §3
├── CHECK: qty_sent >= 0
├── CHECK: qty_sent <= qty_heos_queue  (in-house residual can't be negative)
├── CHECK on return: qty_sent = ok + short + damaged + lost
└── UNIQUE (batch_id, linen_type_id)

laundry_queue                 -- existing table, additive changes
├── + batch_id                uuid → laundry_batches (nullable)
└── state enum extended:      queued | sent | returned | written_off
                              (short → detach: batch_id=NULL, state=queued)

vendors                       -- one column added
└── + vendor_kind             text[]   default '{}'    e.g. {laundry,groceries}

(future, §9)
laundry_invoices
├── id, vendor_id, period_month (date, first-of-month)
├── invoice_number, invoice_amount, currency
├── status (draft, sent, paid), paid_at, paid_by
├── remarks, attachment_path
└── batches JOIN via laundry_batches.invoice_id
```

**Why per-linen-type lines instead of per-queue-row reconciliation:**  
staff count by linen type, vendors write slips by linen type, invoices  
are checked by linen type. Per-queue-row would be friction with zero  
operational benefit for a 23-room property. Queue rows still flip state  
in bulk so per-piece traceability survives.

---

## 5. Batch Number Generation

Format: `LB-YYYYMMDD-NNN` — human, sortable, WhatsApp-friendly.

Implementation: a small Postgres function `next_laundry_batch_number()`  
that reads `MAX(NNN)` for the batch's `business_date` inside a  
`SELECT … FOR UPDATE` on a dedicated sequence row, then formats. Called  
from a `BEFORE INSERT` trigger on `laundry_batches`. This avoids race  
conditions if two staff create a batch at the same moment (rare, but  
free to prevent).

`business_date` uses the same India-TZ business date the rest of HEOS uses,  
so the number matches the operational day even after midnight.

---

## 6. In-House Wash Calculation

Never entered. Always derived:

- **Per line:** `qty_in_house = qty_heos_queue − qty_sent` (generated  
column).
- **Per batch:** `SUM(qty_in_house)` — computed on read.
- **Per queue row bookkeeping:** rows counted "in-house" stay on the  
queue as `queued` if we treat them as "still to wash" OR are flipped  
to a new state `washed_in_house` at pickup time so they don't roll into  
the next batch. Recommendation: **flip to** `washed_in_house` — otherwise  
a batch where staff sent less than HEOS suggested would keep showing  
those rows as "Previous Missing", which is wrong.  
→ extend queue state enum to  
`queued | sent | returned | written_off | washed_in_house`.  
The pickup handler picks the N oldest queued rows per linen type where  
N = `qty_heos_queue`, marks `qty_sent` of them as `sent`, and the  
remainder as `washed_in_house` in the same correlation_id.

---

## 7. Previous Missing (short-return roll-forward)

Short-returned rows are detached from the closed batch:  
`batch_id = NULL`, `state = queued`. They naturally reappear in the next  
pickup's HEOS Queue Count. The pickup screen additionally surfaces the  
**Prev Missing** column by counting rows where  
`state='queued' AND source_task_id IS NOT NULL AND created_at < today's first HK task` — i.e. anything queued but not from today's housekeeping.  
Simple, no extra flag.

They disappear automatically once returned OK or written off.

---

## 8. Photo Storage

New Supabase storage bucket `laundry-slips`, private, RLS-scoped to  
authenticated staff. Two paths per batch:

- `pickup_slip_photo_path` — `laundry-slips/{batch_id}/pickup.jpg`
- `return_photo_path`      — `laundry-slips/{batch_id}/return.jpg`

Both optional. Reuse the compression + upload utility already used by  
guest documents / inventory photos. No new engine.

---

## 9. Activity Log

Additions to `ActivityAction` vocabulary:

- `laundry_batch_sent` — summary "23 bedsheet, 47 pillow cover sent to  
We Wash Laundry (slip WW-4471)"
- `laundry_batch_returned` — summary "45 returned, 2 short, 1 damaged"
- `laundry_batch_cancelled`
- `laundry_in_house_recorded` — emitted only when  
`SUM(qty_in_house) > 0` on a batch

Attribution via `useCurrentStaff` (same rule as HK). Single  
`correlation_id` shared across the batch write + queue-row flips + log.

---

## 10. Monthly Billing — Schema-Ready

Query surfaces already supported by the model:

```sql
-- We Wash Laundry → July 2026
SELECT
  count(*) AS total_batches,
  SUM(l.qty_heos_queue)                       AS total_heos_queue,
  SUM(l.qty_sent)                             AS total_sent,
  SUM(l.qty_returned_ok)                      AS total_returned_ok,
  SUM(l.qty_heos_queue - l.qty_sent)          AS total_in_house,
  SUM(l.qty_short)                            AS outstanding,
  SUM(l.qty_damaged)                          AS damaged,
  SUM(l.qty_lost)                             AS lost
FROM laundry_batches b
JOIN laundry_batch_lines l ON l.batch_id = b.id
WHERE b.vendor_id = :vendor
  AND b.business_date >= '2026-07-01'
  AND b.business_date <  '2026-08-01';
```

Adding the future `laundry_invoices` table + `invoice_id` FK on batches  
is purely additive. No redesign.

---

## 11. Pending-Pickup Warning

Computed on the Laundry page header and the pickup screen:

```sql
SELECT (current_date - MIN(business_date)) AS days
FROM laundry_queue WHERE state = 'queued';
```

If `days >= 2`, show amber banner. If `>= 4`, red. Threshold configurable  
via `app_settings` key `laundry_pickup_warn_days` (default 2/4). No code  
churn to tune.

---

## 12. Implementation Sequencing (revised)

**Two ships, same as v1** — refinements land inside the same envelopes.

### Ship 1 — Send Path

1. Migration: `laundry_batches`, `laundry_batch_lines`, extend
  `laundry_queue.state` (+ `washed_in_house`), add `vendor_kind` to  
   vendors, storage bucket `laundry-slips`, `next_laundry_batch_number()`  
   function + trigger. GRANTs + RLS.
2. APIs: `laundry-batches-api.ts` (`listQueueGrouped`, `previewPickup`,
  `createBatch`, `cancelBatch`), extend `laundry-queue-api.ts` with the  
   flip helpers.
3. Route `/laundry` — tabs: **Queue** (aggregated view + New Pickup CTA)
  and **Batches** (list, filter by vendor / state / month).
4. Send-time screen (§2) with slip #, photo upload, remarks.
5. Sidebar entry, role gate.

### Ship 2 — Return Path + polish

1. Return screen (§3) with photo upload, return remarks.
2. `confirmReturn`: writes ok/short/damaged/lost, detaches shorts,
  flips queue rows, logs activity.
3. Vendor screen: `is_laundry` chip filter (via `vendor_kind`).
4. Batch detail view: header (batch #, vendor, dates, in-house total),
  line table, both photos, both remarks, activity feed.
5. Pending-pickup warning + `app_settings` thresholds.
6. Backlog update.

Ship 1 is standalone-useful; Ship 2 closes the loop and adds the  
billing-ready surface.

---

## 13. Trade-offs Called Out

- **Auto-flipping unused queue rows to** `washed_in_house` **at pickup**  
is a small opinion: a "clever" alternative is to leave them queued and  
compute in-house at read time. We reject that because it makes  
Prev Missing wrong (§6). Cost: one extra enum value + one bulk update.
- **Batch line uniqueness (**`batch_id, linen_type_id`**)** forces one row  
per linen type per batch. If a future workflow ever needs partial  
sub-batches within a batch (unlikely for a 23-room hotel), this would  
need relaxing. We accept that because today it enforces the vendor  
slip's actual structure.
- `qty_sent <= qty_heos_queue` — hard-guards against staff typos  
where they send more than HEOS suggested. If the vendor legitimately  
takes extra linen (e.g. curtains not on HK's radar), that goes through  
a follow-up batch after HK enters it. This matches operational reality  
where linen must exist in the queue before it goes to laundry.
- **Slip photos in a private bucket, not print-ready.** We do not build  
a PDF slip generator. The vendor's handwritten slip is the source of  
truth; HEOS just archives a photo of it.

---

## 14. Open Questions (small — implementation-blocking only)

1. **Multi-vendor tag** — confirm `vendors.vendor_kind text[]` (multi-tag).
  Preferred; keeps a vendor reusable across domains.
2. **Access** — Housekeeping + FO Staff + Admin can create/return batches?
  (Owner read-only.) Recommended.
3. `laundry_pickup_warn_days` **defaults** — 2 amber / 4 red? Adjustable
  later via `app_settings`.

If the above are OK, implementation of Ship 1 can begin.

&nbsp;

Approved. The Laundry design now closely matches our real operational process.

I have only one point that I'd like you to review before starting implementation.

Regarding the proposed washed_in_house queue state:

Please review whether this should remain a long-term queue state or whether the queue item should simply be considered completed with a processing method recorded (vendor vs in_house).

My concern is that the queue should ideally represent only pending work. Once linen has been washed internally, it is no longer pending. However, if after reviewing the implementation you still believe washed_in_house is the cleaner architecture, I'm happy for you to proceed with it—just explain the reasoning in the implementation report.

Apart from that, the Laundry design is approved. Please proceed with Ship 1.