# Implementation Plan

This is a large turn (3 parts). I'll keep it incremental and reuse existing code aggressively to limit regression risk and token spend.

## Part 1 — Quote ↔ Booking Structural Parity (Option b)

Extract shared components — do NOT remove the primary-stay concept.

New shared modules:
- `src/components/shared/StayDetailsForm.tsx` — primary stay fields (dates, room type, rooms, adults, children, extras toggles, breakfast). Used by New Quote, New Booking, Edit Quote, Edit Booking.
- `src/components/shared/ExtrasFields.tsx` — early CI / late CO / pets / drivers / extra beds / extra adults (currently duplicated in `generate.tsx` and `bookings_.new.tsx`).
- `src/components/shared/StaySummary.tsx` — totals + breakdown (uses existing `quote-summary.tsx` logic, generalized to accept either a quote or booking shape).
- `src/components/shared/StayPreview.tsx` — preview/PDF-style layout used by Quote Preview AND Booking Preview, with optional booking-only sections (status, advance, balance, comms).
- `src/components/shared/StayDetailView.tsx` — detail-page renderer (Customer / Stay Info / Extras / Rooms / Split-stay / Summary / Totals).
- `src/lib/stay-calc.ts` — shared subtotal/nights/taxes/totals/advance/balance helpers.

Integration:
- `routes/_authenticated/generate.tsx` (New/Edit Quote) → wrap shared form/summary; keep Convert-to-Booking & lead source.
- `routes/_authenticated/bookings_.new.tsx` & `bookings_.$id_.edit.tsx` → wrap shared form/summary; keep status, advance paid, balance, communication buttons.
- `routes/_authenticated/quote.$id.tsx` and `bookings_.$id.tsx` → use `StayDetailView` + `StayPreview`.

Goal: identical operational UX; booking-only additions remain (Status, Advance, Balance, Comms); quote-only addition remains (Convert).

## Part 2 — Sidebar & User Menu

- Sidebar keeps only operational nav (Dashboard, Customers, Quotes, Bookings, Cash, Complaints, Tasks, Follow-ups, Calendar, Audit, Analytics, Users).
- New `src/components/user-menu.tsx`: avatar button → popover with: Install App, Appearance (Sun/Moon icons inline), Help & Support, Settings, Sign out.
- Remove the bottom user/install/appearance block from sidebar; replace with avatar trigger that opens the user menu (popover on desktop, sheet on mobile).
- Appearance simplified: two icon buttons (☀️ / 🌙), no "Appearance" label.

## Part 3 — Install App native trigger

Refactor `install-app-button.tsx`:
- On click: if installed → toast "App is already installed on this device."
- Else if `beforeinstallprompt` captured → call `prompt()` directly.
- Else if browser supports PWA but no prompt yet (Chrome/Edge desktop/Android) → show short toast with one-tap menu hint (we cannot synthesize the native prompt without the event).
- Else (iOS Safari, Firefox) → manual instructions.

## Part 4 — Complaint Management V1

### Sidebar
Add "Complaints" under operational nav (no separate "Operations" group heading needed to keep things compact — single item).

### Database migration
- `complaint_categories` (id, user_id, name, active, timestamps) — admin-managed master, seed defaults: AC, TV, WiFi, Geyser, Water, Housekeeping, Noise, Food, Staff, Parking, Other.
- `complaints`:
  - id, user_id, complaint_number (auto `CMP-XXXXXX`),
  - complaint_type ('Room' | 'General'),
  - room_number (nullable),
  - customer_id (nullable), booking_id (nullable),
  - category (text), category_other (nullable),
  - priority ('Low'|'Medium'|'High'|'Critical', default Medium),
  - status ('Open'|'In Progress'|'Resolved', default Open),
  - entered_by_staff_id, entered_by_name,
  - assigned_to_staff_id (nullable), assigned_to_name,
  - description (text), resolved_at, created_at, updated_at.
- `complaint_activities`: id, complaint_id, actor_id/name/role, action, field, old_value, new_value, summary, created_at.
- Triggers: `complaints_audit` (insert/update/delete logging incl. assignment + status changes + resolved_at stamping when status → Resolved).
- GRANTs + RLS: select all authenticated; insert auth (user_id = auth.uid()); update auth (any staff); delete admin only. Categories: select all, insert/update/delete admin only.

### API & UI
- `src/lib/complaints-api.ts` — list, get, create, update, setStatus, assign, listActivities; `complaint-categories-api.ts` for master.
- `src/routes/_authenticated/complaints.tsx` — dashboard cards (Open / In Progress / Resolved Today / Critical / This Month / Avg Resolution Time) clickable to filter; list with filters (status, priority, category, assignee, room, date range, search); default sort by priority desc then created desc; "+ New Complaint" opens dialog.
- New Complaint dialog — fields per spec; when Room Complaint + room selected, look up active booking on that room and show "Use Current Guest / Skip" suggestion.
- `src/routes/_authenticated/complaints_.$id.tsx` — detail page (Complaint / Customer / Booking / Activity History) with status & assignment actions.
- Complaint Category Master — accessible from the dashboard for admins (inline dialog), with Add/Edit/Deactivate.

## Out of scope (per request)
- Complaint photos/attachments, SLAs, WhatsApp/maintenance integrations.
- No architectural overhauls to existing quote/booking schemas.

## Risk & rollout
- Shared components added first as drop-ins; pages refactored one at a time.
- DB migration is additive only.
- No breaking changes to existing tables.
