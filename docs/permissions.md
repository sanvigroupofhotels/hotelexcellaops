# HEOS Core v1.0 — Permission Matrix

Permission keys live in `public.permissions` and are mapped to roles via
`public.role_permissions`. Per-user overrides live in
`public.user_permission_overrides`. Effective set is returned by RPC
`my_permissions()`.

## Roles

| Role key       | Purpose                            |
|----------------|------------------------------------|
| `owner`        | Property owner; full access.       |
| `admin`        | Operational admin; full access.    |
| `fo_staff`     | Front-office / reception staff.    |
| `housekeeping` | HK staff; minimal sidebar.         |

Deprecated (blocked by trigger): `reception`, `staff`.

## Permission catalog

Grouped by module. `O/A/F/H` = Owner / Admin / fo_staff / Housekeeping.
`✓` = granted by default. Cells reflect the seed matrix after v1.0
cleanup (Shipment 3 + Master Data restore).

### Dashboard / Navigation

| Key                     | Description                | O | A | F | H |
|-------------------------|----------------------------|---|---|---|---|
| `dashboard.view`        | View dashboard             | ✓ | ✓ | ✓ |   |
| `house_view.view`       | View live House View       | ✓ | ✓ | ✓ |   |

### Booking

| Key                 | Description        | O | A | F | H |
|---------------------|--------------------|---|---|---|---|
| `bookings.view`     | View bookings list | ✓ | ✓ |   |   |
| `bookings.create`   | Create booking     | ✓ | ✓ | ✓ |   |
| `bookings.edit`     | Edit booking       | ✓ | ✓ | ✓ |   |
| `bookings.checkin`  | Check-in           | ✓ | ✓ | ✓ |   |
| `bookings.checkout` | Checkout           | ✓ | ✓ | ✓ |   |
| `bookings.cancel`   | Cancel booking     | ✓ | ✓ |   |   |
| `bookings.refund`   | Issue refund       | ✓ | ✓ |   |   |
| `dues.view`         | Due Collection     | ✓ | ✓ | ✓ |   |

### Cash Book

| Key           | Description   | O | A | F | H |
|---------------|---------------|---|---|---|---|
| `cash.view`   | CashBook view | ✓ | ✓ | ✓ |   |

### Complaints / CRM

| Key                | Description         | O | A | F | H |
|--------------------|---------------------|---|---|---|---|
| `complaints.view`  | View complaints     | ✓ | ✓ | ✓ |   |
| `customers.view`   | Customer directory  | ✓ | ✓ | ✓ |   |

### Operations

| Key                          | Description                | O | A | F | H |
|------------------------------|----------------------------|---|---|---|---|
| `operations.inventory`       | Inventory items            | ✓ | ✓ |   |   |
| `operations.vendors`         | Vendors master             | ✓ | ✓ |   |   |
| `operations.charge_catalog`  | Charge catalogue           |   | ✓ |   |   |
| `operations.hk_issue_types`  | HK issue types             |   | ✓ |   |   |
| `operations.linen_types`     | Linen types                |   | ✓ |   |   |

### Housekeeping

| Key                    | Description             | O | A | F | H |
|------------------------|-------------------------|---|---|---|---|
| `housekeeping.view`    | View HK board           | ✓ | ✓ | ✓ | ✓ |
| `housekeeping.work`    | Claim/complete tasks    |   | ✓ |   | ✓ |

### Laundry

| Key               | Description                | O | A | F | H |
|-------------------|----------------------------|---|---|---|---|
| `laundry.view`    | View queue and batches     | ✓ | ✓ | ✓ | ✓ |
| `laundry.manage`  | Manage batches / statuses  |   | ✓ |   | ✓ |

### Night Audit

| Key                | Description              | O | A | F | H |
|--------------------|--------------------------|---|---|---|---|
| `night_audit.run`  | Execute Night Audit      | ✓ | ✓ | ✓ |   |

### Guest Portal (Ops surface)

| Key                        | Description                      | O | A | F | H |
|----------------------------|----------------------------------|---|---|---|---|
| `guest_portal.ops_view`    | Open guest portal from ops       | ✓ | ✓ | ✓ |   |

### Master Data

| Key              | Description                     | O | A | F | H |
|------------------|---------------------------------|---|---|---|---|
| `master.rooms`   | Rooms master                    | ✓ | ✓ |   |   |
| `master.rates`   | Rates master                    | ✓ | ✓ |   |   |
| `master.others`  | Lead sources, expense types, …  | ✓ | ✓ |   |   |

### Staff

| Key                 | Description        | O | A | F | H |
|---------------------|--------------------|---|---|---|---|
| `staff.master`      | Staff master       | ✓ | ✓ |   |   |
| `staff.attendance`  | Attendance         | ✓ | ✓ | ✓ |   |
| `staff.salary`      | Salary / advances  | ✓ | ✓ |   |   |

### Reporting

| Key                             | Description        | O | A | F | H |
|---------------------------------|--------------------|---|---|---|---|
| `reporting.analytics.view`      | CRM + Owner        | ✓ | ✓ |   |   |
| `reporting.payments.view`       | Payment reports    | ✓ | ✓ |   |   |
| `reporting.housekeeping.view`   | HK reports         | ✓ | ✓ |   |   |
| `reporting.laundry.view`        | Laundry reports    | ✓ | ✓ |   |   |
| `reporting.staff.view`          | Staff reports      | ✓ | ✓ |   |   |
| `reporting.night_audit.view`    | Audit history      | ✓ | ✓ |   |   |

### Users & Access (admin-only)

| Key                     | Description         | O | A | F | H |
|-------------------------|---------------------|---|---|---|---|
| `users.manage_users`    | User CRUD           | ✓ | ✓ |   |   |
| `users.manage_roles`    | Role permissions    | ✓ | ✓ |   |   |
| `users.manage_access`   | Per-user overrides  | ✓ | ✓ |   |   |

### Settings (admin-only)

| Key                          | Description         | O | A | F | H |
|------------------------------|---------------------|---|---|---|---|
| `settings.general`           | General settings    | ✓ | ✓ |   |   |
| `settings.operations`        | Ops settings        | ✓ | ✓ |   |   |
| `settings.branding`          | Branding            | ✓ | ✓ |   |   |
| `settings.documents`         | Retention rules     | ✓ | ✓ |   |   |
| `settings.payment_settings`  | Payment config      | ✓ | ✓ |   |   |
| `settings.integrations`      | Integrations config | ✓ | ✓ |   |   |

## Admin-only / Owner-only operations

- Anything under `/settings/*` is guarded by `AdminOnly`.
- Calendar (`/calendar`) is admin-only.
- Owner Dashboard is admin-only + `reporting.analytics.view`.
- Enum-value app roles (`owner`/`admin`) are not seeded through the UI;
  they are assigned via migration or by an existing owner.

## Export / approval operations

- **Exports** — every report page uses `csv.ts`. No dedicated export
  permission; gated by the report's `view` permission.
- **Approvals** — cancellation, refund, and Night Audit close require
  the corresponding role permission; there is no separate approver
  workflow yet.

## Extending permissions

1. Add a row to `public.permissions` in a migration.
2. Add role grants in `public.role_permissions` in the same migration.
3. Reference the key in `AppSidebar` / `PermissionGate` /
   engine-side checks.
4. Document here.
