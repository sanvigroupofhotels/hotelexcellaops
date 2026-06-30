# HEOS Phase 2 – Operations Module

**Architecture & UX proposal. No code in this shipment.**

## 1. Guiding Principles

- 23-room property → keep it **boringly simple**. No ERP fields, no SKUs, no GRNs, no PO workflow.
- **Mobile-first**: every daily action ≤ 30 seconds, ≤ 3 taps.
- **Two roles only matter**: Reception (front desk + manager view) and Housekeeping (consume + restock).
- **Single source of truth**: every stock change is a *Stock Movement* row. No "current_stock" field that can drift — current stock is always `SUM(movements)`. Cached on the item row for speed, recomputed on write.
- **Auto over manual**: if HEOS already knows a movement (Add Charge → Water Bottle ×2), staff never re-enter it.
- **Reuse before invent**: photos via existing `guest_documents`-style storage bucket; vendors share the contact pattern from `customers`; activity logging uses the existing `activity_log`.

## 2. Recommended Navigation

I recommend a **phased rollout** and a slightly different menu shape than the brief:

```text
Operations
├── Inventory         ← Phase 2A (ship first)
│   ├── Items
│   ├── Low Stock     ← landing tab on mobile
│   ├── Movements     ← audit log
│   └── Stock Take    ← periodic reconciliation
├── Vendors           ← Phase 2A (shipped with Inventory)
├── Laundry           ← Phase 2B (after Inventory is live ~2 weeks)
└── Maintenance       ← Phase 2C (reuses Vendors + Photos + Movements concepts)
```

**Recommendation accepted**: postpone Laundry + Maintenance. Inventory will produce three reusable primitives (Vendor, StockMovement, Photo attachment) that both later modules will lean on. Designing them now without a concrete consumer risks over-engineering.

Sidebar placement: new top-level **Operations** group (collapsible, same pattern as Reporting/Settings), visible to Admin/Owner/Reception. Housekeeping users (future role) get a trimmed view — Items + Low Stock + Quick Stock Out only.

## 3. Database Design

Four new tables. All in `public`, all with explicit GRANTs + RLS, `created_at/updated_at`, soft-delete via `active` boolean (no hard deletes — movement history must stay referential).

### 3.1 `inventory_categories` (lookup, seedable)

- `id`, `key` (slug), `label`, `sort_order`, `active`
- Seed: Beverages, Toiletries, Cleaning, Kitchenware, Housekeeping Supplies, Disposables.
- Kept as a table (not enum) so admins can add categories without a migration. Mirrors the `master_data` pattern already in HEOS.

### 3.2 `vendors`


| field               | notes                                                    |
| ------------------- | -------------------------------------------------------- |
| `name`              | required                                                 |
| `contact_person`    | required                                                 |
| `phone`             | required, normalized via existing `normalize_phone_in()` |
| `alt_phones text[]` | optional                                                 |
| `address`           | optional                                                 |
| `maps_url`          | optional (Google Maps link)                              |
| `notes`             | optional                                                 |
| `active`            | default true                                             |


Phone normalization reuses the existing trigger so vendor numbers land in canonical `+91XXXXXXXXXX` form and `tel:` links Just Work on mobile.

### 3.3 `inventory_items`


| field                             | notes                                                                                 |
| --------------------------------- | ------------------------------------------------------------------------------------- |
| `name`                            | required, unique (case-insensitive)                                                   |
| `photo_path`                      | storage path in `inventory-photos` bucket (private, signed URLs)                      |
| `category_id`                     | FK → `inventory_categories`                                                           |
| `preferred_vendor_id`             | FK → `vendors` (nullable)                                                             |
| `unit`                            | text — "bottle", "sachet", "litre", "piece" (free text, autosuggest from past values) |
| `current_stock`                   | numeric, **cached**; recomputed by trigger on every movement                          |
| `minimum_stock`                   | numeric                                                                               |
| `auto_consume_charge_keys text[]` | links to charge catalog keys; see §5                                                  |
| `housekeeping_per_room numeric`   | nullable; reserved for future HK auto-consumption (see §7)                            |
| `active`                          | default true                                                                          |


`unit` deliberately stays free text. A 23-room hotel does not need a UoM conversion engine.

### 3.4 `inventory_movements`  *(the source of truth)*


| field                                  | notes                                                                                                                       |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `item_id`                              | FK                                                                                                                          |
| `delta`                                | numeric, signed. **Negative = out, Positive = in.**                                                                         |
| `reason`                               | enum: `stock_in`, `stock_out`, `auto_charge`, `auto_housekeeping`, `stock_take_adjust`, `wastage`, `transfer`, `correction` |
| `source_type`                          | nullable, e.g. `booking_charge`                                                                                             |
| `source_id`                            | nullable FK (uuid) to the originating row — enables auto-reversal                                                           |
| `unit_cost`                            | optional numeric (for future cost reporting; staff can ignore)                                                              |
| `vendor_id`                            | nullable, only meaningful for `stock_in`                                                                                    |
| `notes`                                | optional                                                                                                                    |
| `actor_id`, `actor_name`, `actor_role` | populated by `current_actor()`                                                                                              |
| `correlation_id`                       | links to `activity_log`                                                                                                     |


Rules:

- Movements are **append-only**. Edits = new compensating movement. This is the same pattern as `booking_payments` and is what makes audit trustworthy.
- Trigger on insert: `UPDATE inventory_items SET current_stock = current_stock + NEW.delta`.
- Trigger on the originating entity's update/delete (Add Charge changes water bottles 2→3, or row is deleted): the inventory linkage emits a compensating `auto_charge` movement. Idempotency key = `(source_type, source_id)`; the linker stores the *current* delta it has applied and writes only the difference on subsequent edits.

### 3.5 Storage bucket

- `inventory-photos` — private bucket. Same access pattern as `staff-documents`. Single photo per item is enough; multi-photo can come later by extending to a child table without breaking the API.

## 4. Auto-Consumption: full scenario map

The "Add Charge → Water Bottle ×2" flow is the load-bearing case. Every edge needs a defined behaviour:


| Event on booking_charges                           | Inventory effect                                                                                                                                                      |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| INSERT charge with `auto_consume` mapping          | Insert movement `delta = -qty`, reason `auto_charge`, source = charge row                                                                                             |
| UPDATE qty (2 → 3)                                 | Insert movement `delta = -1` (diff only)                                                                                                                              |
| UPDATE qty (3 → 1)                                 | Insert movement `delta = +2`                                                                                                                                          |
| UPDATE item (Water → Coffee)                       | Compensating movements: refund Water by old qty, deduct Coffee by new qty                                                                                             |
| DELETE / VOID charge                               | Insert movement `delta = +originally_applied`                                                                                                                         |
| Booking cancelled before checkout                  | Charges already deducted: reversed via per-charge delete cascade — **no separate booking-cancel handler needed**. This is why we anchor on charge rows, not bookings. |
| Charge edited after night audit close              | Still allowed; inventory just records the compensating movement on today's business date. Audit history remains intact.                                               |
| Mapping changes (admin links/unlinks a charge key) | Past movements untouched; only future charges follow the new rule.                                                                                                    |


The mapping itself lives on `inventory_items.auto_consume_charge_keys` so admins control it from the Item screen — no separate "rules" table needed at 23 rooms.

## 5. Shared Business Logic (`src/lib/`)

Proposed pure modules, mirroring how `booking-status.ts` and `customer-resolution.ts` were structured:

- `inventory-movements.ts` — single write path: `recordMovement({item, delta, reason, source, notes})`. All UI calls this; no direct table writes.
- `inventory-auto-consume.ts` — `applyChargeDelta(chargeRow, previousChargeRow|null)` invoked from the existing charge save/delete pipeline. Idempotent.
- `inventory-availability.ts` — `getLowStockItems()`, `getCurrentStock(itemId)`, mirroring `room-counts.ts` as single source of truth for any dashboard widget.
- `vendors-api.ts` — thin CRUD + phone normalization passthrough.

Everything else (forms, lists) is presentation.

## 6. UX Wireframes

### 6.1 Inventory landing (mobile, default tab = Low Stock)

```text
┌─────────────────────────────────┐
│ Inventory          [＋ Item]    │
│ [Low Stock•3] [All] [Movements] │
├─────────────────────────────────┤
│ ⚠ Hand Wash                     │
│ 2 / 10 bottles                  │
│ Sharma Supplies · 📞 Call       │
│ [Stock In]                      │
├─────────────────────────────────┤
│ ⚠ Coffee Sachets                │
│ 18 / 50 sachets                 │
│ Nestlé Local · 📞 Call          │
│ [Stock In]                      │
└─────────────────────────────────┘
```

- `📞 Call` is a `tel:` link to the vendor's normalized phone — the manager-calls-supplier flow takes one tap.
- `Stock In` opens a single-field sheet: quantity + optional invoice photo + optional unit cost. Vendor pre-filled from preferred vendor.

### 6.2 Item detail

```text
[photo]
Water Bottle 1L
Beverages · Preferred: Sharma Supplies

Current  48 bottles      Minimum  20
Auto-consume: ☑ when "Water Bottle" charge is added

[Stock In]  [Stock Out]  [Edit]

Recent movements
  −2  Booking #B1042  (auto) · 2h ago · Riya
  +60 Stock In · Sharma Supplies · yesterday · Vikram
  −1  Booking #B1039  (auto) · yesterday · Riya
```

The movement list IS the audit trail. No separate audit page needed for Phase 2A.

### 6.3 Stock Out sheet (manual consumption)

Single screen: item picker (search) → quantity → optional reason → Save. 3 taps for the common case (Hand Wash refilled in 102 → −1).

### 6.4 Vendors

Mirror Customers list pattern: search by name/phone, tap row → detail with `Call`, `WhatsApp`, `Open in Maps`, linked items, recent stock-ins.

### 6.5 Stock Take

Periodic (weekly/monthly). Renders a checklist of active items with current cached stock and an editable "counted" field. On save, generates `stock_take_adjust` movements for each diff in a single `correlation_id` so the audit shows them as one event.

## 7. Future Extensibility (designed for, not built)

The `housekeeping_per_room` field + `auto_housekeeping` movement reason are reserved hooks. When Housekeeping module ships, "Mark Room Clean" emits one auto-consumption movement per linked item (1 coffee sachet, 1 tea sachet, etc.) — **no schema change required**, only a new caller of `recordMovement()`. This is the payoff for treating movements as the primitive.

Likewise Laundry can model linen as inventory items with custom reasons (`laundry_out`, `laundry_in`), and Maintenance can attach photos + vendors to work-order rows using the same storage bucket and vendor table.

## 8. Risks & Mitigations


| Risk                                            | Mitigation                                                                                                                                             |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Cached `current_stock` drifts from movement sum | Nightly job (extend Night Audit) recomputes from movements; mismatch logged to `activity_log`.                                                         |
| Charge ↔ inventory mapping confusion for staff  | Mapping lives on the Item screen, not buried in Settings. Inline help: "When 'Water Bottle' is added to a bill, deduct 1 from this item."              |
| Photo bloat in storage                          | Max 1 photo per item, resized client-side to ~800px before upload — same approach as guest documents.                                                  |
| Reception forgets manual stock-outs (Hand Wash) | Low Stock screen surfaces them. Weekly Stock Take catches the rest. Accept that some categories will be approximate — that's appropriate for 23 rooms. |
| Over-zealous auto-consumption on edits          | Idempotent per-source delta engine; comprehensive scenario table in §4 is the spec — every branch must have a test before code ships.                  |
| Vendor data duplicated with `customers` later   | Keep `vendors` separate. They're a different domain (B2B supplier vs guest); merging causes more pain than it saves.                                   |


## 9. Recommendations / Decisions Needed

1. **Confirm phasing**: ship Inventory + Vendors as Phase 2A; defer Laundry + Maintenance. *(I recommend yes.)*
2. **Roles**: do we add a `housekeeping` app_role now, or keep everything under Reception until the Housekeeping module lands? *(I recommend deferring — adding a role with no exclusive screens is noise.)*
3. **Cost tracking**: store `unit_cost` on stock-in for future P&L, even though no UI surfaces it yet? *(I recommend yes — costs nothing now, unlocks reports later.)*
4. **Charge catalog linkage**: today charges are free-text labels. To make auto-consume reliable we need either (a) a small "charge catalog" lookup, or (b) match by label. *(I recommend a tiny* `charge_catalog` *table — same shape as* `master_data`*. This is the only non-trivial prerequisite and worth deciding before coding.)*
5. **Stock units**: keep free text + autosuggest, or constrain to a small enum? *(I recommend free text.)*

---

**Next step**: please review §4 (auto-consumption matrix) and §9 (decisions). Once you confirm, I will produce Shipment 2A.1: schema migration + Vendors CRUD + Inventory Items CRUD with photos, with the auto-consume engine following in 2A.2.

&nbsp;

&nbsp;

My comments - 

&nbsp;

Overall, I like the proposed architecture. It aligns well with the direction I want HEOS to take. I have a few comments before implementation:

&nbsp;

1. Inventory Categories

&nbsp;

Please reuse our existing Master Data module for Inventory Categories instead of introducing a separate inventory_categories table. This keeps all configurable lookup values in one place.

&nbsp;

&nbsp;

---

&nbsp;

2. Vendor Module

&nbsp;

The Vendor screen should remain lightweight.

&nbsp;

Mandatory fields:

&nbsp;

Vendor Name

&nbsp;

Contact Person

&nbsp;

Mobile Number

&nbsp;

&nbsp;

Optional fields:

&nbsp;

Google Maps Location

&nbsp;

Physical Address

&nbsp;

Alternate Mobile Numbers (Add More)

&nbsp;

Notes

&nbsp;

Active / Inactive

&nbsp;

&nbsp;

No GST, payment terms, banking details, etc. at this stage.

&nbsp;

&nbsp;

---

&nbsp;

3. Inventory Simplicity

&nbsp;

Please always remember that HEOS is being built for a 23-room hotel.

&nbsp;

The inventory workflow should remain extremely simple so staff actually use it.

&nbsp;

Our guiding principle should be:

&nbsp;

> If HEOS already knows something happened, staff should never have to enter it again.

&nbsp;

&nbsp;

&nbsp;

Examples:

&nbsp;

Water Bottles sold through Add Charge → Inventory should reduce automatically.

&nbsp;

If the charge quantity changes, inventory should adjust only by the difference.

&nbsp;

If the charge is deleted/cancelled, inventory should be restored automatically.

&nbsp;

Housekeeping consumables (cleaning chemicals, handwash, etc.) remain manual stock movements.

&nbsp;

&nbsp;

&nbsp;

---

&nbsp;

4. Charge Mapping

&nbsp;

I agree that matching free-text labels is not a good long-term solution.

&nbsp;

I support introducing a small Charge Catalog so inventory auto-consumption is mapped to a charge definition instead of relying on text matching.

&nbsp;

&nbsp;

---

&nbsp;

5. Bulk Operations

&nbsp;

Please include support for:

&nbsp;

Bulk Stock In (one purchase containing multiple inventory items)

&nbsp;

Bulk Stock Out (one consumption entry affecting multiple inventory items)

&nbsp;

&nbsp;

This will make day-to-day inventory updates much faster.

&nbsp;

&nbsp;

---

&nbsp;

6. Low Stock Screen

&nbsp;

The Low Stock screen should display:

&nbsp;

Item

&nbsp;

Current Stock

&nbsp;

Minimum Stock

&nbsp;

Preferred Vendor

&nbsp;

Vendor Mobile Number

&nbsp;

&nbsp;

The idea is that the manager should be able to identify the shortage and immediately contact the supplier.

&nbsp;

&nbsp;

---

&nbsp;

7. Unit Cost

&nbsp;

I agree with storing Unit Cost in the database for future reporting, but there is no need to expose it in the UI right now.

&nbsp;

&nbsp;

---

&nbsp;

8. Inventory Reconciliation

&nbsp;

I suggest renaming Stock Take to Inventory Reconciliation (or Physical Stock Verification) as it is more intuitive for our staff.

&nbsp;

&nbsp;

---

&nbsp;

9. Photos

&nbsp;

One photo per inventory item is sufficient.

&nbsp;

Please do not add invoice photo uploads at this stage.

&nbsp;

&nbsp;

---

&nbsp;

10. Overall Goal

&nbsp;

The Operations module should follow the same philosophy as the Booking module:

&nbsp;

Keep it simple.

&nbsp;

Keep it fast.

&nbsp;

Mobile-first.

&nbsp;

Minimize clicks.

&nbsp;

Reuse shared business logic.

&nbsp;

Avoid ERP-style complexity.

&nbsp;

&nbsp;

If a common task takes more than 30 seconds, we should rethink the workflow before implementing it.