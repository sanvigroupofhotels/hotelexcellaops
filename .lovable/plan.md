## Shipment Plan – UAT Fixes & Operational Enhancements

This is a sizeable shipment. Confirming scope before I touch code so we ship the right pieces in the right order. I'll batch into logical chunks.

---

### 1. Notification Center

**A. Mobile bell**

- Surface `NotificationBell` in the mobile shell (currently `hidden md:flex` in Topbar). Add it to the mobile header alongside the sidebar trigger so reception sees the badge + popover on phones. Same component, same actions (mark read, mark all, dismiss, navigate).

**B. Push notifications**

- Add a Web Push subscription flow on first sign-in (notification permission prompt, store subscription in a new `push_subscriptions` table keyed by user_id, RLS scoped to owner).
- Add a server-side dispatcher (server fn + DB trigger fan-out) that fires a Web Push payload whenever a row lands in `public.notifications`. Uses VAPID keys stored as secrets (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`). Service worker handles click → deep-link to the entity URL embedded in payload.
- iOS Safari requires "Add to Home Screen" to receive push — I'll surface a one-line hint on the bell when permission is denied or PWA not installed.
- **Question:** OK to add VAPID keys as secrets? I'll generate them and add via secret tool. No third-party push provider needed.

**C. Lead Abandoned → Draft Booking**

- Today the `lead_abandoned` notification metadata points at the lead row. I'll change `notify_lead_abandoned` (or the click handler) so the entity link resolves to the draft booking created for that lead. If no draft booking exists, fall back to the lead detail page. Click navigates straight to `/bookings/<draft_id>/edit`.

---

### 2. Guest Portal Search (PMS side, `portal.tsx` admin search)

- Consolidate into one search box that accepts: full portal URL, raw token, booking reference, or mobile number. Detect input type by pattern (URL/UUID/`BK-…`/digits).
- Remove the duplicate second search section.
- Mobile number flow:
  - 1 active booking → open it
  - &nbsp;
  > 1 active → list selector
  - 0 active → most recent booking
- Wire each path end-to-end and remove dead branches.

---

### 3. Portal "Secured by Razorpay" line

Move the security note from the bottom of the portal to directly under the "Complete Your Booking" payment options (`PortalPaymentOptions`), above the Additional Services group.

---

### 4. House View Mobile Layout

- Row 1: Stats + Search side-by-side
- Row 2: Today button + Business Date selector side-by-side
- Tighten top padding, collapse vertical gaps, raise the timeline grid.
- Preserve sticky headers, sticky room column, drag & drop, long-press, debug overlay.
- Mobile only — desktop layout unchanged.

---

### 5. FabHotels Integration

- Investigate why save/test errors mention Gmail. Likely a shared validator gating on `gmail_connected` regardless of provider.
- Decouple: each integration's validator only checks its own required config (FabHotels needs property credentials, not Gmail).
- Return clear error messages per missing field.
- Verify save → test → enable → run end-to-end.

---

### 6. Due Collection Logic Rework

- Eligibility = `balance_due > 0 AND status NOT IN (Cancelled, Draft)` AND `check_in <= business_date`.
- Due Date = original `check_in` date (frozen).
- Show every Business Date until balance ≤ 0 or cancelled — drop any check-out-based filter.
- Overdue label computed from `business_date - check_in`:
  - 0 → "Due Today"
  - N>0 → "Overdue by N day(s)"
- Page reads Business Date (Asia/Kolkata) from `app_settings`, not calendar date.
- Confirms with existing Night Audit (no schema changes needed — list is a query over `bookings`).

---

### 7. UAT validation

After each chunk, Playwright in headless against `localhost:8080` for the affected page (portal search, house view mobile viewport, dues). Notification push needs a real device for end-to-end — I'll verify permission flow + service worker registration + a manual send round-trip in the sandbox; real-device push verification will be the user's UAT step.

---

### Order of execution

1. House View mobile layout (low risk, visible win)
2. Portal Razorpay message move (trivial)
3. Guest Portal search consolidation
4. Notification bell on mobile + Lead Abandoned navigation
5. Due Collection logic
6. FabHotels validator fix
7. Web Push (largest, last — touches SW, DB, secrets)

### Technical notes

- New table `push_subscriptions(user_id, endpoint, p256dh, auth, user_agent, created_at)` with RLS scoped to `auth.uid()`.
- Service worker at `public/sw.js` (or extend existing) for `push` and `notificationclick`.
- Push dispatch via a `createServerFn` invoked by a Postgres trigger using `pg_net` → `/api/public/dispatch-push` (HMAC-signed), since DB triggers can't hit `web-push` directly. Webhook handler signs with VAPID and sends to each subscription, prunes 410s.

---

### Confirm before I start

1. **OK to add a** `push_subscriptions` **table + VAPID secrets and a** `/api/public/dispatch-push` **webhook for push fan-out?** (Alternative: skip push for now, ship 1A+1C and the rest.)
2. **Lead Abandoned click target** — confirm: open the auto-created draft booking edit page; if none exists, open the lead. Correct?
3. **Dues "most recent booking" rule** — the spec says portal mobile-number search falls back to most recent when none active. Confirm "most recent" = latest by `check_in DESC`. Correct?

- Once you confirm (or say "go" to all), I'll execute in the order above.

The plan looks good overall. Please proceed with the shipment.

&nbsp;

A few clarifications before implementation:

&nbsp;

1. Push Notifications

&nbsp;

Yes, you may proceed with the proposed architecture.

&nbsp;

I'm happy with:

&nbsp;

- "push_subscriptions" table

- VAPID keys as secrets

- Service Worker

- "/api/public/dispatch-push" webhook

- No third-party push provider

&nbsp;

Please keep the implementation generic and reusable so all future operational notifications can use the same framework.

&nbsp;

---

&nbsp;

2. Lead Abandoned Navigation

&nbsp;

Confirmed.

&nbsp;

When a Lead Abandoned notification is clicked:

&nbsp;

- If a Draft Booking has already been created, open the Draft Booking directly.

- If no Draft Booking exists, fall back to the Lead detail page.

&nbsp;

That is the expected behaviour.

&nbsp;

---

&nbsp;

3. Guest Portal Search

&nbsp;

Confirmed.

&nbsp;

For Mobile Number search:

&nbsp;

- If exactly one active booking exists → open it directly.

- If multiple active bookings exist → show a booking selection list.

- If there are no active bookings → open the most recent booking (latest by Check-In Date).

&nbsp;

Please ensure all of the following are supported from a single search box:

&nbsp;

- Full Guest Portal URL

- Portal Token

- Booking Reference

- Mobile Number

&nbsp;

Remove the duplicate search section once this is complete.

&nbsp;

---

&nbsp;

4. Due Collection Logic

&nbsp;

The proposed logic is almost correct.

&nbsp;

Please make one important adjustment.

&nbsp;

The page should not simply show all checked-in bookings with balance_due > 0.

&nbsp;

Instead:

&nbsp;

- The original Due Date should be the Check-In Date.

- Once the booking becomes due, it should remain in the Due Collection list on every subsequent Business Date until:

  - Outstanding balance becomes zero, or

  - Booking is cancelled.

&nbsp;

If the guest extends the stay, the booking should continue appearing in Due Collection until payment is collected.

&nbsp;

The Business Date drives the Due Collection page.

&nbsp;

The original Due Date should remain unchanged.

&nbsp;

The overdue calculation should always be based on the original Check-In Date.

&nbsp;

---

&nbsp;

Everything else in the shipment looks good.

&nbsp;

Please proceed in the planned execution order and provide the shipment summary after completion.

&nbsp;