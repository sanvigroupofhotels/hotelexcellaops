# Maintenance Module — Architecture & Milestones

Freeze acknowledged: Booking, Booking Items, Occupancy Segments, Availability, Pricing, Charges, Payments, Night Audit, HK integration, Search, Clone, Room Operations are closed to architectural change. Auth stays as-is (signups disabled, email auto-confirm on).

The Maintenance Module is added as a **new engine** (`Maintenance`) that plugs into existing engines as an adapter — never a second implementation of occupancy, availability, HK or activity logging.

---

## 1. Position in the shared-engine map

```text
Maintenance Engine
  owns:  work orders, their lifecycle, assignment, cost, parts, room out-of-order windows
  reads: Rooms, Business Date, Vendors, Complaints, HK tasks, Occupancy segments
  writes:room_maintenance blocks (existing table) + new maintenance_* tables
  emits: activity log entries (the existing event bus)

Occupancy / Availability  ← Maintenance only ever writes an OOO window; availability
                             continues to read it via occupancy-source.listMaintenanceBlocks()
Housekeeping              ← HK issue → work order; work order completion → HK re-clean task
Night Audit               ← nightly sweep: overdue orders, expiring OOO windows
Reporting                 ← read-only aggregation over maintenance snapshots
Activity Timeline         ← same logActivity trail, reusing BookingItemTimeline patterns
```

Non-negotiable rules carried over:
- Availability is read only through `src/lib/availability.ts`; the module never queries `booking_room_assignments` or computes overlap itself.
- Any Out-of-Order window is written through one function that inserts/closes `room_maintenance` rows (the existing block table stays the single occupancy-visible representation). `blocks-api.ts` becomes an internal detail of the maintenance engine rather than a parallel path.
- "Today" always comes from `getBusinessDate()`.
- Every state change emits `logActivity`.

---

## 2. Data model (additive only)

New tables (public schema, RLS + GRANTs per project standard):

- `maintenance_categories` — small master list (Electrical, Plumbing, AC, Carpentry, Civil, IT/Network, Furniture, Safety), maps to existing HK issue types and complaint categories via nullable link columns. Reuses the Master Data engine style.
- `maintenance_work_orders`
  - identity: `code` (MO-XXXXXX), `title`, `description`, `category_id`, `priority` (low/normal/high/critical)
  - location: `room_id` (nullable) or `area_label` for public areas
  - lifecycle: `status` (Reported → Acknowledged → In Progress → On Hold → Resolved → Verified → Closed / Cancelled), `reported_at`, `due_date`, `resolved_at`, `closed_at`
  - ownership: `assigned_staff_id`, `assigned_vendor_id` (Vendor engine, `vendor_kind` gains `maintenance`)
  - occupancy link: `blocks_room` bool, `maintenance_block_id` → `room_maintenance.id`
  - source link: `source` (manual | hk_issue | complaint | night_audit), `hk_task_id`, `complaint_id`
  - cost: `estimated_cost`, `actual_cost`
- `maintenance_work_order_notes` — timestamped notes + photo paths (reuses existing photo picker / storage conventions).
- `maintenance_work_order_parts` — optional consumption lines linked to `inventory_items`, posting movements through the existing Inventory engine (`inventory-movements.ts`), never direct stock updates.

`room_maintenance` gains one nullable column: `work_order_id`, so an OOO window is always traceable to its order. No behavioural change for existing blocks.

RPCs for atomic transitions where multiple tables move together: `maintenance_open_work_order`, `maintenance_transition_status`, `maintenance_close_work_order` (closes any OOO window + fires HK re-clean).

---

## 3. Service layer

```text
src/lib/maintenance-api.ts        CRUD + list/filter/search for work orders
src/lib/maintenance-status.ts     status graph, allowed transitions, derived badges
src/lib/maintenance-operations.ts orchestration: open / assign / hold / resolve / verify / close
                                  → OOO window via room-blocks, HK hook, activity log
src/lib/maintenance-room-status.ts single derivation of a room's maintenance state for
                                  House View / Rooms / HK (Operational | OOO | Under Repair)
src/lib/reporting/maintenance-reporting.ts  read-only aggregation (MTTR, by category, cost)
```

`blocks-api.ts` is refactored (not duplicated) so that room blocking flows through `maintenance-operations.ts`, keeping one write path to `room_maintenance`.

---

## 4. UI surfaces

- `/operations/maintenance` — work order list: filters (status, priority, category, room, assignee, overdue), search via a maintenance adapter over the shared search patterns.
- `/operations/maintenance/$id` — detail: header + status actions, notes/photos timeline, parts, cost, linked HK task / complaint, OOO window control.
- New Work Order dialog — reusable `<MaintenanceWorkOrderDialog>`, the single creation surface, opened from Maintenance list, Room card (House View long-press menu), HK issue, and Complaint detail.
- House View / Rooms: OOO rooms show a maintenance lane badge sourced from `maintenance-room-status.ts` (no new availability math).
- Dashboard: "Open maintenance" + "Overdue" tiles, and a Critical Work Orders row in Night Audit.
- Reporting: Maintenance report using `ReportDateRangePicker` and the reporting engine conventions.

Permissions: new `maintenance.view` / `maintenance.manage` capabilities in the Access engine; housekeeping role gets view + raise, admin/owner get manage. Sidebar entry gated by `PermissionGate`.

---

## 5. Milestones

**M1 — Foundation (schema + engine + list/detail, manual only)**
Tables, RLS/GRANTs, RPCs, `maintenance-api` / `-status` / `-operations`, list + detail routes, create dialog, permissions, activity logging, sidebar entry. No integrations yet beyond room blocking.

**M2 — Occupancy & Room Status integration**
OOO windows created/closed exclusively via the engine, `work_order_id` backlink, House View + Rooms + assignment dialogs reflect Under-Repair state through `maintenance-room-status.ts`, guard against blocking an occupied room without an explicit move, availability verified unchanged via `availability.ts`.

**M3 — Housekeeping & Complaints integration**
HK issue → work order (one click, linked both ways), complaint → work order, resolution → HK re-clean task before the room returns to sellable, HK screens show open orders per room.

**M4 — Night Audit, Reporting & Timeline**
Nightly sweep (overdue orders, OOO windows expiring today, unverified resolutions) added to the existing Night Audit sweep list; maintenance report (open/closed, MTTR, cost by category/vendor, room downtime); shared maintenance timeline component; notification routing for critical/overdue orders through the Notification engine.

**M5 — Vendors, Parts & Costing**
`maintenance` vendor kind, vendor assignment + turnaround tracking, parts consumption posting inventory movements, estimated vs actual cost, optional cost roll-up in reporting.

Each milestone ships with: migration summary, API changes, UI changes, regression tests (`tests/e2e/`), manual validation checklist, deferred items — the same "What Changed" report format used through PMS development.

---

## 6. Deferred / out of scope for now

Preventive-maintenance schedules (recurring plans), asset register per room, QR-code technician mobile view, guest-visible repair status, external vendor portal. All are additive on top of M1–M5.
