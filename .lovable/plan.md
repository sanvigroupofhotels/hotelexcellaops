# HEOS Housekeeping Task Engine — Design Freeze (v2, no code)

Design-only. Incorporates all 14 comments from the review round. Awaiting your explicit "go" on **3A.0** before any code.

## 1. Core Philosophy (locked)

- Housekeeping never manages statuses. They complete **tasks**. HEOS derives status.
- Housekeeping lands directly on Today's Tasks — no dashboard, no KPIs, no graphs (**C3**). Working in ≤ 2 seconds of login.
- Reception owns exceptions only. Everything else is automatic.
- Reuse every existing engine. No duplicate business logic.

## 2. Status Model — Two Layers

Booking Status (existing) is untouched. Housekeeping Status is orthogonal, and it has **two representations** (**C1**, **C2**):

### 2.1 Internal (DB truth — full state machine)

```text
housekeeping_status_internal:
  ready │ dirty │ cleaning │ needs_service │ servicing │ out_of_service
```

### 2.2 Displayed in House View (reception-facing, simplified — C1)

```text
Ready │ Dirty │ Needs Service │ Out of Service
```

Mapping (view-layer only, no separate column):

| internal | House View shows |
|---|---|
| `ready` | Ready |
| `dirty` | Dirty |
| `cleaning` | **Dirty** (task in progress is not exposed as a room state) |
| `needs_service` | Needs Service |
| `servicing` | **Needs Service** (same reasoning) |
| `out_of_service` | Out of Service |

`cleaning` / `servicing` remain internally for audit/attribution and to prevent double-start; they are task states, not room states.

### 2.3 State machine

```text
                    guest_checked_out
     [any]  ─────────────────────────────►  dirty
     dirty  ── start_cleaning ─►  cleaning  ── finish_cleaning ─►  ready
     ready  ── night_audit + still_occupied ─►  needs_service
     needs_service ── start_service ─►  servicing ── finish_service ─►  ready   (C2: no "service completed" state)
     needs_service ── reception: Service Not Required / Do Not Disturb ─►  ready  (drops off task list for the day)
     [any]  ── maintenance_block   ─►  out_of_service   (Phase 2C; independent of hk axis)
```

Key invariants:
- Checkout ALWAYS forces `dirty`, regardless of prior hk status.
- Night audit sets `needs_service` on every currently-occupied room whose hk status is `ready`. Rooms mid-`cleaning`/`servicing` are left alone.
- After Finish Service → `ready`. Next night audit generates the next day's service task (**C2**).
- Dirty rooms with an open maintenance complaint stay `dirty` on the task list. Maintenance is a parallel axis.

## 3. Database Design

### 3.1 New enums

```text
housekeeping_status:      ready | dirty | cleaning | needs_service | servicing | out_of_service
housekeeping_task_type:   checkout_clean | continue_service
housekeeping_task_state:  open | in_progress | done | skipped
```

### 3.2 `rooms` — add columns

| column | notes |
|---|---|
| `housekeeping_status` | enum, default `ready`. Trigger-managed. |
| `hk_status_changed_at` / `hk_status_changed_by` | audit |

No component writes `housekeeping_status` directly — only via `hk-status.ts`.

### 3.3 `housekeeping_tasks` (new)

One row per task instance.

| column | notes |
|---|---|
| `id` | uuid |
| `room_id` | FK rooms |
| `booking_id` | FK bookings, nullable |
| `business_date` | date |
| `type` | `checkout_clean` \| `continue_service` |
| `state` | `open` \| `in_progress` \| `done` \| `skipped` |
| `started_at` / `finished_at` | timestamps (**C5** — raw timestamps only; no average calc in Phase 3A) |
| `performed_by_user_id` | "Working As" user |
| `recorded_by_user_id` | logged-in user |
| `skipped_reason` | `not_required` \| `dnd` \| `superseded_by_checkout` \| null |
| `remarks` | text |
| `consumables_snapshot` | **jsonb** — full list of `{inventory_item_id, name_at_time, qty}` submitted (**C13**) |
| `linen_snapshot` | **jsonb** — `{linen_type_id, name_at_time, qty}[]` submitted (**C13**) |
| `issues_snapshot` | **jsonb** — `{issue_type_id, label_at_time, complaint_id?, note}[]` (**C13**) |
| `correlation_id` | groups all side effects |
| `created_at` / `updated_at` | |

Partial unique: `(room_id, business_date, type)` where `state IN ('open','in_progress')`.

### 3.4 `housekeeping_room_exceptions`

| column | notes |
|---|---|
| `room_id`, `business_date` | PK |
| `reason` | `service_not_required` \| `do_not_disturb` (**C7** — user-friendly labels) |
| `set_by_user_id`, `notes` | |

### 3.5 `linen_types` (master, under Operations → Masters — C12)

`id, name, default_qty (int ≥1), sort_order, active`.

### 3.6 `hk_issue_types` (master, under Operations → Masters — C12)

`id, label, sort_order, active, default_complaint_category_id (nullable FK)`.

UI always injects a synthetic **"No Issue"** first option (not stored, non-deletable).

### 3.7 `laundry_queue` (feeds future Laundry module)

`id, room_id, booking_id?, linen_type_id, qty, source_task_id, state ('queued'|'sent'|'returned'), business_date, actor fields`.

**Never** deducts inventory (**C10**). Laundry module owns linen from this point.

### 3.8 `inventory_items` — add columns

| column | notes |
|---|---|
| `show_in_housekeeping` | boolean, default false |
| `hk_default_qty` | int, default 1 — auto-fills task screen qty (**C8**) |

### 3.9 Grants / RLS

Standard grants to `authenticated` and `service_role`, no `anon`. Housekeeping role: full read on own-day tasks, write via helpers only. Master edits: `has_role('admin')`. Full policy list ships with the migration.

## 4. Shared Business Logic (new `src/lib/`)

| helper | responsibility |
|---|---|
| `hk-status.ts` | Single write path for `rooms.housekeeping_status`. Enforces state machine. Emits `activity_log`. |
| `hk-tasks.ts` | `startTask`, `completeTask`, `skipTask`. `completeTask` runs the whole fanout under one `correlation_id`. |
| `hk-generator.ts` | `generateContinueServiceTasks(businessDate)` — called by night audit. Idempotent per `(room_id, business_date, type)`. |
| `hk-checkout-hook.ts` | Called by checkout flow. Marks room `dirty` + creates `checkout_clean` task. Idempotent. Also `skipped='superseded_by_checkout'` on any open service task for that room/day. |
| `linen-master-api.ts`, `hk-issue-types-api.ts` | Thin CRUD; admin-only writes. |
| `laundry-queue-api.ts` | Insert-on-task-submit. Read helpers reserved for Phase 2B. |
| `use-hk-working-as.ts` | Session-scoped "Working As" (see §5.2). |
| `use-hk-task-counts.ts` | `{remaining, completed, total}` for header progress (**C4**). |

### 4.1 Reused engines (no duplication)

| Concern | Reuses |
|---|---|
| Recorder identity | existing `useCurrentStaff()` |
| Performer identity | new `useHkWorkingAs()` |
| Inventory decrement (Section 1) | `recordMovement()` with `reason='auto_housekeeping'`, `source_type='hk_task'`, `source_id=task.id` |
| Issues → complaints (Section 3) | `complaints-api.createComplaint()` — **non-blocking** (C9) |
| Audit trail | `logActivity()` with `correlation_id` |
| Business date | `app_settings.business_date` + night-audit trigger |
| Room status display | House View, extended with the simplified 4-state overlay |
| Auth / roles | `useUserRole()`; new role `housekeeping` |

### 4.2 `completeTask` fanout (C9 — complaint failures never block completion)

```text
completeTask(taskId, payload)
├── validate task is open/in_progress and business_date matches
├── snapshot consumables/linen/issues into task row
├── for each consumable line  →  recordMovement(item, -qty, auto_housekeeping)   [transactional]
├── for each linen line       →  laundry_queue.insert(qty = linen_type.default_qty at time of submit) [transactional; NO inventory movement — C10]
├── update task: state=done, finished_at, performer, recorder, remarks
├── hk-status: cleaning→ready OR servicing→ready
├── activity_log: hk_task_completed  (correlation_id)
└── for each issue (best-effort, outside main txn — C9):
       try complaints.create(category, room, remarks)
       on failure → activity_log('hk_issue_complaint_failed', {issue, error}) — task stays done
```

Rationale for C9: a broken Complaint engine must never leave a room stuck in `cleaning`.

## 5. UX

### 5.1 Housekeeping login lands on `/housekeeping` (Today's Tasks only — C3, C4)

```text
┌───────────────────────────────────────┐
│  Today · Mon 6 Jul             [☰]   │
│  Working as: Lakshmi  ▾               │  ← sticky
│  11 / 16 Completed                    │  ← progress (C4)
├───────────────────────────────────────┤
│  CHECKOUT ROOMS · 3                   │
│  ┌───────────────────────────────┐   │
│  │ 201 · Oak                     │   │
│  │ Checked out 10:42 · Dirty     │   │
│  │              [ Start Cleaning]│   │
│  └───────────────────────────────┘   │
│  ...                                  │
├───────────────────────────────────────┤
│  SERVICE ROOMS · 5                    │
│  ┌───────────────────────────────┐   │
│  │ 105 · Teak                    │   │
│  │ Needs Service                 │   │
│  │              [ Start Service ]│   │
│  └───────────────────────────────┘   │
└───────────────────────────────────────┘
```

- No House View, no filters, no search, no charts.
- Progress line is text only: `11 / 16 Completed` (or `Remaining : 5 · Completed : 11`) — never a graph.
- Completed / skipped tasks vanish instantly (optimistic + realtime).
- Empty state: "All caught up."

### 5.2 Working As picker (C6 — includes FO Staff)

- List = **[logged-in user always first] + [all other active users whose role is `housekeeping` OR `fo_staff`]**, sorted by name.
- FO Staff can therefore complete tasks themselves without needing the housekeeping role.
- No "Myself" label.
- Persists in `sessionStorage` keyed by logged-in user id; cleared on logout/tab close.

### 5.3 Task screen (identical for both types)

```text
┌──────────────────────────────────────┐
│  ← 201 · Oak    Checkout Cleaning    │
├──────────────────────────────────────┤
│  1. Consumables Refilled             │
│     ☐ Water Bottle   qty [ 2 ]       │  ← qty pre-filled from
│     ☐ Coffee Sachet  qty [ 2 ]       │    inventory_items.hk_default_qty (C8)
│     ☐ Tea Sachet     qty [ 2 ]       │    editable if needed
├──────────────────────────────────────┤
│  2. Linen Changed                    │
│     ☐ Bedsheet      (auto qty 1)     │  ← from linen_types.default_qty
│     ☐ Pillow Cover  (auto qty 2)     │    NOT editable by housekeeping
│     ☐ Bath Towel    (auto qty 2)     │
├──────────────────────────────────────┤
│  3. Issues                           │
│     ● No Issue                       │  ← always first, non-deletable
│     ○ TV     ○ AC    ○ Bathroom Lt   │
│     ○ Furniture   ○ Other            │
├──────────────────────────────────────┤
│  4. Remarks (optional)               │
│     [ ______________________ ]       │
├──────────────────────────────────────┤
│  Performed by: Lakshmi               │
│  Recorded by:  Pavan                 │
│  [        Finish Cleaning        ]   │
└──────────────────────────────────────┘
```

- Consumable qty defaults from `hk_default_qty`, editable via existing `NumField` (fractional-safe).
- Linen qty is read-only (driven by master; snapshot into `laundry_queue.qty` at insert).
- Selecting any issue other than "No Issue" reveals a one-line note field per issue.
- Button label: `Finish Cleaning` (checkout) vs `Finish Service` (continue-stay). Same screen otherwise.

### 5.4 Reception exceptions (C7 — friendly labels)

Inside House View room card, when hk status is `needs_service` today, add two actions:
- **"Service Not Required"**
- **"Do Not Disturb"**

Both write `housekeeping_room_exceptions` and immediately flip hk status to `ready` for the day. Undoable until end of business date.

### 5.5 House View overlay (C1, C11 — single reception surface)

- Reception continues in existing House View. No separate housekeeping page for FO Staff (**C11**).
- Overlay uses the simplified 4-state vocabulary only: Ready · Dirty · Needs Service · Out of Service.
- FO Staff can jump into any listed task from House View → room card → "Open Task" (routes to the same task screen at §5.3). Housekeeping users land directly on `/housekeeping`. **Single task engine, two entry points.**

## 6. State Transition Matrix

| Trigger | From | To (internal) | House View shows | Side effects |
|---|---|---|---|---|
| Checkout confirmed | any | `dirty` | Dirty | Create `checkout_clean` task; skip any open service task |
| "Start Cleaning" | `dirty` | `cleaning` | Dirty | task.state=in_progress, started_at |
| "Finish Cleaning" | `cleaning` | `ready` | Ready | Inventory, laundry, complaints (non-blocking), activity |
| Night audit (occupied) | `ready` | `needs_service` | Needs Service | Create `continue_service` task unless exception row exists |
| "Service Not Required" / DND | `needs_service` | `ready` | Ready | Exception row; task `skipped` |
| "Start Service" | `needs_service` | `servicing` | Needs Service | task.state=in_progress, started_at |
| "Finish Service" | `servicing` | `ready` (C2) | Ready | Same fanout as cleaning; next audit generates next day's service task |
| Maintenance block | any except cleaning/servicing | `out_of_service` | Out of Service | Task list unaffected if was `dirty` |
| Maintenance unblock | `out_of_service` | previous | previous | none |

## 7. Edge Cases

| # | Case | Decision |
|---|---|---|
| 1 | Guest checks out same day they were served earlier | Any open service task is set `skipped='superseded_by_checkout'`; fresh `checkout_clean` created. |
| 2 | Room `cleaning` when night audit runs | Left alone. Finishes to `ready`; next day audit re-evaluates. |
| 3 | Reception marks DND, guest later asks for service | Delete exception row; task regenerates on next generator poll (or via reception "Add Service Task"). |
| 4 | Two users open same task | Optimistic lock on state transition; second submit gets "Already completed by X". |
| 5 | Inventory item flagged `show_in_housekeeping` but out of stock | Movement still recorded; stock can go negative (matches existing inventory behavior). Low-stock dashboard catches it. |
| 6 | Linen type deactivated mid-day | Open tasks still show it (from snapshot); new tasks don't. |
| 7 | Issue type has no `default_complaint_category_id` | Falls back to seeded "Housekeeping Report" category. Never blocks task completion. |
| 8 | Task submitted with zero selections | Allowed. Records visit + performer + snapshots. |
| 9 | Business date rewound | Existing guard trigger prevents future dates. Generator is idempotent, safe to re-run. |
| 10 | Housekeeping user deactivated mid-session | Working As list refreshes; in-flight task remains attributable (performed_by is uuid, not live join). |
| 11 | Dirty + open maintenance complaint | Stays on Checkout list. Two independent axes. |
| 12 | FO Staff completes task on behalf of housekeeping | Fully supported — recorder=FO uid, performer=selected user. |
| 13 | Complaint engine down at completion | Task still completes; failed issues logged to `activity_log` for later reconciliation (**C9**). |

## 8. Reception View Integration

- House View stays the primary reception surface (**C11**).
- Adds the 4-state hk overlay (**C1**) and the two exception actions (**C7**).
- No separate housekeeping page for FO Staff.
- Owner/admin dashboard gets a small text tile "Housekeeping today: 3 checkout · 5 service · 11 done" — text only, no chart (**C3** applies to housekeeping module; owner dashboard tile is acceptable because it isn't the housekeeping surface).

## 9. Navigation

```text
Sidebar (housekeeping role):
└── Today's Tasks          ← the only item

Sidebar (admin/owner/fo_staff):
Operations
├── Inventory
├── Vendors
├── Charge Catalog
└── Masters                ← existing group (C12)
    ├── (existing masters …)
    ├── Linen Types         (new)
    └── Housekeeping Issues (new)
Reporting
└── Housekeeping             (raw counts + Started/Finished timestamps; no averages in Phase 3A — C5)
```

## 10. User Management & Roles

- Rename **Staff Management → User Management** (route/label; DB unchanged this shipment).
- New role enum values (add, not replace): `admin`, `owner`, `fo_staff`, `housekeeping`.
- Deprecated (kept for backfill, hidden from pickers): `reception`, `staff`, `maintenance`, `laundry`.
  - Migration maps existing users: `reception → fo_staff`; `staff/maintenance/laundry → housekeeping` unless already admin/owner.
  - Dropping enum values is Phase 4 cleanup.
- Login = **username + password**. Internally synthesized `<username>@hotelexcella.in` (never shown in UI). New `profiles.username` column, unique, `[a-z0-9._-]{3,32}`.
- Password reset by admin only (existing admin flow).
- `has_role('housekeeping')` gates `/housekeeping` route; sidebar hides everything else for that role.
- `has_role('fo_staff') OR has_role('housekeeping') OR has_role('admin') OR has_role('owner')` gates the task screen entry from House View.

## 11. Future Modules — Hooks Already Present

| Future | Hook |
|---|---|
| **Laundry (2B)** | `laundry_queue` already populated by every linen check. Laundry UI is filter + `sent`/`returned` transitions. Linen never touches inventory (**C10**). |
| **Maintenance (2C)** | `out_of_service` hk status + independence from `dirty` defined. Maintenance writes hk status via `hk-status.ts`. Complaints engine handles the ticket side. |
| **Notification Engine** | Every hk transition emits `activity_log`; notification wiring subscribes to those events. |
| **Per-performer analytics** | `performed_by_user_id`, `started_at`, `finished_at` captured. Averages computed later in Reporting when Phase 3B needs them (**C5**). |

## 12. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Night audit creates service tasks for rooms guests asked to skip | Generator checks exception row before insert. |
| Reception forgets to mark "Service Not Required" | Housekeeping card offers "Skip · not required" inline that back-fills the exception. |
| Duplicate tasks | Partial unique on `(room_id, business_date, type)` + idempotent hooks. |
| Shared phone leaves stale "Working As" | Session-scoped; visible in header; cleared on logout / tab close. |
| Housekeeping role sees financial data | Sidebar gate + route gate + dashboard role check. |
| Linen master edited mid-day | Snapshot to `laundry_queue.qty` + `linen_snapshot` on the task at submit time. |
| Complaint engine failure blocks room release | Complaint creation is non-blocking (**C9**); task completion always succeeds. |
| Audit reconstruction after schema changes | Full `consumables_snapshot` / `linen_snapshot` / `issues_snapshot` on task row (**C13**). |

## 13. Implementation Sequencing (when you say "go")

1. **3A.0** — Role additions (`fo_staff`, `housekeeping`); username-based login (synthesized email hidden); User Management rename; backfill migration for deprecated roles.
2. **3A.1** — Enums + `rooms.housekeeping_status` + `housekeeping_tasks` (with snapshot jsonb columns) + exceptions table + triggers + grants/RLS.
3. **3A.2** — Masters: `linen_types`, `hk_issue_types`, `inventory_items.show_in_housekeeping`, `inventory_items.hk_default_qty` — all under Operations → Masters (**C12**).
4. **3A.3** — Shared helpers (`hk-status`, `hk-tasks`, `hk-generator`, `hk-checkout-hook`, `laundry-queue-api`) + wire into existing checkout + night audit.
5. **3A.4** — `/housekeeping` Today's Tasks + Working As picker + task completion screen.
6. **3A.5** — House View 4-state overlay + reception exception actions ("Service Not Required" / "Do Not Disturb") + FO Staff task entry point from House View.
7. **3A.6** — Reporting → Housekeeping (raw counts + started/finished timestamps only — no averages yet).

Phase 2B (Laundry) and 2C (Maintenance) revisited after 3A is in production for 2 weeks.

## 14. Deferred (tracked, out of scope for this design)

- **C14 — Quick Booking pricing parity** with Detailed Booking (override total, override engine, discount behavior, same pricing pipeline, no separate pricing logic). To be picked up as a standalone shipment after Housekeeping 3A closes.

---

**Design is frozen pending your explicit "go" on 3A.0. No code will be written until then.**
