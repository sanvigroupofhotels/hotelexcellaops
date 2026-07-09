# HEOS Core v1.0 — Navigation

Single source of truth for sidebar, submenus, routes, deep links, role
visibility. Reflects `src/components/app-sidebar.tsx` and
`src/routes/_authenticated/*`.

## Sidebar structure

```
Dashboard                       /                           dashboard.view
House View                      /house-view                 house_view.view
Calendar                        /calendar                   admin only
Bookings                        /bookings                   bookings.view
  ▸ End of Day (group)
      Dashboard                 /night-audit                house_view.view
      Critical Tasks            /night-audit/critical-tasks house_view.view
      End of Day Report         /night-audit/eod-report     house_view.view
      Audit History             /night-audit/history        reporting.night_audit.view
Due Collection                  /dues                       dues.view
CashBook                        /cash                       cash.view
Complaints                      /complaints                 complaints.view
Customers                       /customers                  customers.view
Staff Management                /staff-management/*         staff.master|attendance|salary
Master Data                     /master-data                master.rooms|master.rates|master.others
Housekeeping (group)            /housekeeping
    Today's Tasks               /housekeeping               (open)
    Linen Types                 /operations/linen-types     admin only
    Housekeeping Issues         /operations/hk-issue-types  admin only
Laundry                         /laundry                    laundry.view
Inventory (group)               /operations
    Inventory Items             /operations/inventory       (open)
    Vendors                     /operations/vendors         (open)
Reporting (group)               /reporting
    Owner Dashboard             /reporting/owner-dashboard  admin + reporting.analytics.view
    CRM Analytics               /reporting/crm-analytics    reporting.analytics.view
    Payment Reports             /reporting/payments         reporting.payments.view
    Housekeeping                /reporting/housekeeping     reporting.housekeeping.view
    Laundry                     /reporting/laundry          reporting.laundry.view
    Staff Reporting             /reporting/staff            reporting.staff.view
    Activity Tracking           /reporting/activity         (open)
Users (group)                   /users
    User Management             /users/management           users.manage_users
    Role Management             /users/roles                users.manage_roles
    Access Management           /users/access               users.manage_access
Settings (group)                /settings                   admin only
    General                     /settings/general           settings.general
    Operations                  /settings/operations        settings.operations
    Branding                    /settings/branding          settings.branding
    CRM & Notifications         /settings/crm               settings.general
    Documents Retention         /settings/documents         settings.documents
    Payment Settings            /settings/payment-settings  settings.payment_settings
    Integrations                /settings/integrations      settings.integrations
```

## Role-based collapsed view

- **Housekeeping role** collapses to a single `Today's Tasks` entry.
- **fo_staff** sees House View, End of Day, Dues, Cash, Complaints,
  Customers, Housekeeping, Laundry, Reporting (limited), Guest Portal
  (from ops).
- **admin / owner** sees everything.

## Deep-link inventory

Public and semi-public:

- `/be`, `/booking-engine/*` — public booking flow.
- `/portal/$token` — signed guest portal.
- `/login` — auth.

Ops-only (all under `_authenticated`):

- `/bookings/$id`, `/bookings/$id/edit`, `/bookings/new`, `/bookings/quick`
- `/customers/$id`
- `/complaints/$id`
- `/staff/$id/ledger`
- `/settings/integrations/$id`

## Hidden / legacy routes

Redirects preserved for muscle-memory and shared links:

| Legacy | Redirect target |
|---|---|
| `/quote/*` | `/bookings` |
| `/generate` | `/bookings/new` |
| `/history` | `/bookings` |
| `/reports` | `/reporting/owner-dashboard` |
| `/follow-ups` | `/bookings` |
| `/audit` | `/reporting/activity` |
| `/analytics` | `/reporting/crm-analytics` |
| `/access-settings` | `/users/roles` |
| `/operations` | `/operations/inventory` |
| `/settings` | `/settings/general` |
| `/users` | `/users/management` |

## Breadcrumbs

Currently not surfaced globally. Individual detail pages
(`bookings_.$id.tsx`, `customers_.$id.tsx`) include an inline
back-link. Adding global breadcrumbs is a candidate follow-up; the
route tree already carries enough hierarchy.

## Mobile navigation

- Sidebar is off-canvas via a hamburger trigger in
  `src/components/app-sidebar.tsx`.
- Notification bell (`notification-bell.tsx`) and user menu are pinned
  to the mobile topbar.
- Housekeeping mobile experience is the primary daily surface for the
  housekeeping role — designed for phone-first.

## Adding a new route

1. Create `src/routes/_authenticated/<slug>.tsx` with `createFileRoute`.
2. If gated, add a permission key via migration + `docs/permissions.md`.
3. Add sidebar entry to `app-sidebar.tsx` in the correct group with the
   right `permission` / `anyOf` / `adminOnly` predicate.
4. Never edit `src/routeTree.gen.ts` — Vite plugin regenerates it.
