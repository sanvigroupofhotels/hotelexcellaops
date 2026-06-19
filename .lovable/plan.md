## Shipment Plan — Comms sweep, Users hierarchy, Night Audit Action Center, Invoice redesign

### Phase 1 — Communication Time Sweep (final)
**Goal**: Every check-in/out display shows `dd-MMM-yyyy, h:mm AM/PM` using `useOpsTimeLabels()` (or `getOpsTimeLabels()` for sync builders).

Audit + fix:
- `src/routes/_authenticated/bookings_.$id.tsx` — Booking Preview / Detail header & summary cards (HIGH PRIORITY — this is the user's #1 complaint).
- `src/routes/_authenticated/house-view.tsx` — popups, arrival/departure tiles.
- `src/routes/_authenticated/bookings.tsx` — list rows.
- `src/routes/_authenticated/bookings_.new.tsx` + `bookings_.$id_.edit.tsx` — summary panels.
- `src/lib/booking-messages.ts` — WhatsApp / email confirmation strings (use sync `getOpsTimeLabels()`).
- `src/components/invoice-dialog.tsx`, `src/components/quote-summary.tsx`, `src/components/pricing-breakdown.tsx`.
- `src/routes/portal.$token.tsx` (verify).
- Any `format(date, "dd-MMM-yyyy")` for check-in/out across the codebase — `rg` sweep, replace.

### Phase 2 — Users hierarchy (Sidebar reorganization)
**Goal**: Collapse `User Management` + `Access Management` (and new `Role Management`) under a single `Users` expandable group.

- `src/components/app-sidebar.tsx`: remove standalone `User Management` and `Access Management` items; add `ExpandableGroup label="Users" prefix="/users"` with three children:
  - `/users/management` → User Management
  - `/users/roles` → Role Management (NEW)
  - `/users/access` → Access Management
- Create routes:
  - `src/routes/_authenticated/users.tsx` (layout `<Outlet />`)
  - `src/routes/_authenticated/users.management.tsx` (move existing `users.tsx` content here)
  - `src/routes/_authenticated/users.roles.tsx` (NEW — see Phase 3)
  - `src/routes/_authenticated/users.access.tsx` (re-export of existing `access-settings.tsx` content)
- Keep `/users` redirecting to `/users/management`.

### Phase 3 — Role Management page (NEW)
At `/users/roles`. Reads from `roles`, `permissions`, `role_permissions` (existing tables — already used by `access-api.ts`).
- List all roles with row counts.
- Inline create / rename / delete (non-system roles only).
- Permission matrix (role × permission grid with toggle), grouped by `permissions.module`.
- Uses existing `togglePermission`, `createRole`, `updateRole`, `deleteRole`.

### Phase 4 — Access Management = user-level overrides
Refactor `/users/access` to be **per-user permission overrides** on top of role-derived perms. Requires new table:
```sql
CREATE TABLE public.user_permission_overrides (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  permission_key text not null references public.permissions(key) on delete cascade,
  granted boolean not null default true,  -- true=grant override, false=deny override
  expires_at timestamptz null,
  notes text,
  created_at timestamptz default now(),
  unique(user_id, permission_key)
);
```
+ GRANTs, RLS (admin manage, self read), and update `my_permissions()` RPC to union role perms with `granted=true` overrides and subtract `granted=false` overrides (respecting `expires_at`).

UI: pick a user → see effective permissions (role-inherited vs override) → add/remove overrides with optional expiry.

### Phase 5 — Night Audit UX
- `src/routes/_authenticated/house-view.tsx`: remove second "Night Audit" button next to Business Date; keep only the top-right one.
- `src/components/night-audit-dialog.tsx`: convert to **Action Center**:
  - Tabbed/sectioned: Pending Check-Ins | Pending Check-Outs | Audit Summary.
  - Row columns: Booking ID, Guest, Room, Check-In, Check-Out, Status.
  - Row actions: View (link to detail), Check-In (open existing check-in flow / dialog), Check-Out, Extend Stay (existing extend dialog).
  - Footer keeps the existing "Perform Night Audit" button (disabled until both lists empty).

### Phase 6 — Invoice & Proforma redesign (HIGH PRIORITY)
Rewrite `src/components/invoice-dialog.tsx` print layout for a single-page, hotel-grade A4 document that also reflows on mobile.

Layout (single page when possible):
```
┌──────────────────────────────────────────────┐
│  [LOGO]   HOTEL EXCELLA              INVOICE │
│           address · GST · contact     #INV-… │
│                                       Date    │
├──────────────────────────────────────────────┤
│  Bill To             │  Stay Details         │
│  Guest name          │  Check-In  17-Jun, 1PM│
│  Phone · Email       │  Check-Out 18-Jun,11AM│
│  Address             │  Nights · Adults/Kids │
│                      │  Room(s)              │
├──────────────────────────────────────────────┤
│  Description       Qty   Rate   GST   Amount │
│  Room charge …                               │
│  Extra charges…                              │
├──────────────────────────────────────────────┤
│  Payment History                Sub-total    │
│  date · mode · ref · amt        Tax          │
│                                 TOTAL  ₹     │
│                                 Paid         │
│                                 Balance      │
├──────────────────────────────────────────────┤
│  Refunds (if any)                            │
├──────────────────────────────────────────────┤
│  Notes / Terms              Authorized Sig.  │
│  Thank you for staying      [signature.png]  │
│                             Designation      │
└──────────────────────────────────────────────┘
```

Implementation:
- Use Tailwind print + responsive utilities (`print:`, `sm:`, `md:`), `@page { size: A4; margin: 12mm }`.
- Compact typography (11pt body, 9pt table), tight spacing.
- All check-in/out timestamps via `useOpsTimeLabels()`.
- Premium feel: subtle gold rule lines (`border-gold/30`), serif display font for headings already in theme, no heavy fills.
- Mobile: single column, totals card pinned, tables horizontally scrollable only if necessary.
- Proforma variant: same shell, header label "PROFORMA INVOICE", omits payment history (or shows "advance received").

### Phase 7 — Payment Settings inheritance verification
- Read `bookings_.new.tsx` + `bookings_.$id_.edit.tsx` and confirm `getPaymentSettings()` defaults populate `payment_mode`, `payment_terms`, etc.
- Add fallback initializer where missing. Booking-level edits already override (existing form state).

### Out of scope (per user)
- FabHotels & Hotelzify stay disabled. No parser work this shipment.

### Order of execution
1. Phase 1 (comms sweep, fastest user-visible win)
2. Phase 5 (Night Audit UX — small, isolated)
3. Phase 2 (sidebar + route shells)
4. Phase 3 (Role Management page)
5. Phase 4 (Access overrides — migration + UI)
6. Phase 7 (payment defaults verification)
7. Phase 6 (Invoice redesign — largest)

Proceeding in this order. Each phase compiles independently so partial shipment is safe.