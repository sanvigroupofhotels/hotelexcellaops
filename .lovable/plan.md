
# HEOS Phase 2 – Operations Module (Revised after review)

**Architecture & UX. No code until explicit go-ahead.**

## Changes from v1 (per your comments)

| # | Decision | Effect on plan |
|---|---|---|
| 1 | Reuse Master Data for categories | Drop `inventory_categories` table. Add category `inventory_category` to existing `master_data` catalog. |
| 2 | Vendor module stays lightweight | Locked field list — no GST, payment terms, banking. |
| 3 | Simplicity is the rule | Auto-consume for HEOS-known events; manual for HK consumables. Documented in §4. |
| 4 | Charge Catalog approved | New small `charge_catalog` table is a prerequisite to Inventory auto-consume. |
| 5 | Bulk Stock In + Bulk Stock Out | New shared bulk movement screen and helper. |
| 6 | Low Stock columns locked | Item, Current, Minimum, Preferred Vendor, Vendor Mobile + Call. |
| 7 | Unit Cost stored, not shown | Field stays in DB; no UI surface in Phase 2A. |
| 8 | Rename "Stock Take" → **Inventory Reconciliation** | Applied across menu, screens, audit reasons. |
| 9 | One photo per item, no invoice photo | Drop invoice photo upload from Stock In sheet. |
| 10 | Operations follows Booking philosophy | 30-second rule is the acceptance criterion for every screen. |

## 1. Navigation (unchanged structure, renamed item)

```text
Operations
├── Inventory                  ← Phase 2A
│   ├── Low Stock              (mobile landing)
│   ├── Items
│   ├── Movements              (audit feed)
│   └── Inventory Reconciliation
├── Vendors                    ← Phase 2A
├── Laundry                    ← Phase 2B (deferred)
└── Maintenance                ← Phase 2C (deferred)
```

Sidebar: new collapsible **Operations** group, visible to Admin/Owner/Reception.

## 2. Database Design (revised)

Three new tables + Master Data reuse + Charge Catalog. All with explicit GRANTs, RLS, `created_at/updated_at`, soft-delete via `active`.

### 2.1 Categories — reuse `master_data`
- Category key: `inventory_category`
- Seed values: Beverages, Toiletries, Cleaning, Kitchenware, Housekeeping Supplies, Disposables.
- Inventory items reference the master_data row's `value` (slug) — same pattern used elsewhere in HEOS.

### 2.2 `vendors` (locked fields)
| Mandatory | Optional |
|---|---|
| `name` | `address` |
| `contact_person` | `maps_url` |
| `phone` (normalized via `normalize_phone_in`) | `alt_phones text[]` |
| | `notes` |
| | `active` (default true) |

Nothing else. No GST, no banking, no payment terms.

### 2.3 `charge_catalog` (prerequisite for auto-consume)
| field | notes |
|---|---|
| `key` | slug, unique — stable identifier |
| `label` | display text shown on bill |
| `default_price` | numeric, optional |
| `taxable` | boolean |
| `active` | default true |

- Add Charge dialog switches from free text to picker against this catalog (free text remains allowed as "Other" for one-off items, but those will not auto-consume — by design).
- Existing `booking_charges` rows gain an optional `catalog_key` column; legacy free-text rows continue to work untouched.

### 2.4 `inventory_items`
| field | notes |
|---|---|
| `name` | required, case-insensitive unique |
| `photo_path` | single photo in `inventory-photos` bucket |
| `category_value` | references `master_data.value` where category='inventory_category' |
| `preferred_vendor_id` | FK → `vendors` (nullable) |
| `unit` | free text + autosuggest |
| `current_stock` | cached numeric; recomputed by movement trigger |
| `minimum_stock` | numeric |
| `auto_consume_catalog_key` | nullable; FK to `charge_catalog.key`. Single key per item keeps mapping unambiguous. |
| `housekeeping_per_room` | nullable; reserved hook for future HK auto-consumption |
| `active` | default true |

### 2.5 `inventory_movements` (single source of truth)
Append-only; edits = compensating rows. Same shape as v1:
- `item_id`, `delta` (signed), `reason` enum, `source_type`, `source_id`, `unit_cost` (stored, not shown), `vendor_id` (only on `stock_in`), `notes`, actor fields, `correlation_id`, `batch_id` (uuid — groups bulk operations so audit shows one event).
- Reasons: `stock_in`, `stock_out`, `auto_charge`, `auto_housekeeping`, `reconciliation_adjust`, `wastage`, `correction`.
- Insert trigger updates the cached `current_stock`.

### 2.6 Storage
- `inventory-photos` — private bucket, signed URLs, ~800px client-resize. Same pattern as `staff-documents`.
- **No invoice photo storage in Phase 2A** (per comment 9).

## 3. Auto-Consumption Scenario Map (unchanged — load-bearing)

Anchored on `booking_charges` rows via `(source_type='booking_charge', source_id=charge.id)`. Idempotent per source.

| Event on `booking_charges` | Inventory effect |
|---|---|
| INSERT with mapped `catalog_key` | `delta = -qty`, reason `auto_charge` |
| UPDATE qty (2→3) | `delta = -1` (difference only) |
| UPDATE qty (3→1) | `delta = +2` |
| UPDATE catalog_key (Water→Coffee) | refund Water by old qty, deduct Coffee by new qty |
| DELETE / VOID | `delta = +originally_applied` |
| Booking cancelled | Cascades through charge deletions — no separate handler |
| Edit after night audit close | Compensating movement on today's business date; audit history intact |
| Mapping changed on item | Past movements untouched; only future charges follow new rule |

## 4. Bulk Operations (new, per comment 5)

Shared UI + shared helper. Two flows:

### 4.1 Bulk Stock In
One purchase from one vendor → multiple items in one shot.
```text
Vendor: Sharma Supplies        Invoice date: today
─────────────────────────────────────────────────
Water Bottle 1L      qty [60]  unit cost [9]
Coffee Sachets       qty [100] unit cost [3]
Hand Wash 250ml      qty [10]  unit cost [55]
[＋ Add item]
                                       [Save]
```
Saves N movements sharing one `batch_id` → audit log shows one "Bulk Stock In · 3 items · Sharma Supplies" event, drillable to rows.

### 4.2 Bulk Stock Out
Same shape, vendor row removed, reason required (e.g. "Monthly housekeeping refill").

Both reuse `recordBulkMovement({reason, vendor?, lines[]})` in `inventory-movements.ts`.

## 5. UX

### 5.1 Inventory landing — Low Stock (per comment 6)
```text
┌─────────────────────────────────┐
│ Inventory          [＋ Item]    │
│ [Low Stock•3] [Items] [Movements│
├─────────────────────────────────┤
│ ⚠ Hand Wash                     │
│ 2 / 10 bottles                  │
│ Sharma Supplies · +91 98xxxxxxxx│
│ 📞 Call    [Stock In]           │
├─────────────────────────────────┤
│ ⚠ Coffee Sachets                │
│ 18 / 50 sachets                 │
│ Nestlé Local · +91 99xxxxxxxx   │
│ 📞 Call    [Stock In]           │
└─────────────────────────────────┘
```
Locked columns: Item · Current · Minimum · Preferred Vendor · Vendor Mobile + Call.

### 5.2 Item Detail
Photo, name, category, preferred vendor, current/min, auto-consume mapping ("Auto-deducts when 'Water Bottle' is added to a bill"), Stock In / Stock Out / Edit, recent movements (audit IS the list).

### 5.3 Stock In sheet (single item, no invoice photo)
Quantity · unit cost (optional, never shown back) · notes. Vendor pre-filled from preferred vendor. 30 sec ✓.

### 5.4 Stock Out sheet
Quantity · reason (optional) · notes. 30 sec ✓.

### 5.5 Bulk Stock In / Bulk Stock Out
As §4. Reachable from Inventory header overflow menu and Vendor detail.

### 5.6 Vendors
List sorted by name. Detail shows Call · WhatsApp · Open in Maps · linked items · recent stock-ins.

### 5.7 Inventory Reconciliation
Checklist of active items with cached stock and editable "counted" field. Save → N `reconciliation_adjust` movements under one `batch_id` and one `correlation_id`.

## 6. Shared Business Logic (`src/lib/`)

- `inventory-movements.ts` — `recordMovement()`, `recordBulkMovement()`. Single write path. All UI calls this.
- `inventory-auto-consume.ts` — `applyChargeDelta(newCharge, prevCharge|null)`. Idempotent; hooked into existing charge save/delete pipeline.
- `inventory-availability.ts` — `getLowStockItems()`, `getCurrentStock(itemId)`. Single source of truth for any dashboard widget.
- `vendors-api.ts` — thin CRUD; phone normalization passthrough.
- `charge-catalog-api.ts` — CRUD for the new catalog.

## 7. Future Extensibility (designed for, not built)

- `housekeeping_per_room` + `auto_housekeeping` reason are reserved. When HK module ships, "Mark Room Clean" calls `recordMovement()` per linked item — no schema change.
- Laundry models linen as items with `laundry_out` / `laundry_in` reasons + same bulk helper.
- Maintenance reuses `vendors` + `inventory-photos` bucket pattern.

## 8. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Cached `current_stock` drift | Night Audit recomputes from movements; mismatch → `activity_log`. |
| Charge mapping confusion | Mapping lives on Item screen with inline plain-English help. |
| Staff skip manual Stock Outs | Low Stock screen surfaces gaps; weekly Reconciliation catches the rest. |
| Over-zealous auto-reversal on edits | Idempotent per-source delta engine; §3 scenario map is the spec — every branch gets a test before merge. |
| Bulk screens become busy | Hard cap UI hint: keep one screen ≤ 12 lines; tap "Save & Add more" otherwise. |

## 9. Implementation Sequencing (proposed)

When you say go:
1. **Shipment 2A.0** — `charge_catalog` table + Add Charge picker migration (prerequisite).
2. **Shipment 2A.1** — `vendors` CRUD + Master Data seed for `inventory_category`.
3. **Shipment 2A.2** — `inventory_items` CRUD with single photo + Low Stock screen + Item detail + single-item Stock In/Out.
4. **Shipment 2A.3** — `inventory-auto-consume` engine wired into `booking_charges`. Full scenario test suite.
5. **Shipment 2A.4** — Bulk Stock In / Bulk Stock Out + Inventory Reconciliation.

Phase 2B (Laundry) and 2C (Maintenance) revisited after 2A is in production for 2 weeks.

---

**Awaiting your explicit "go" before any code is written.** Confirm or amend §9 sequencing and I'll start with 2A.0.
