# Notification Framework — Architecture & Operations Guide

_Last updated: 2026-06 (Phase 3, Shipment 4)_

This document explains how notifications work end-to-end in Hotel Excella PMS and how to operate, recover, and extend them.

---

## 1. Goals

1. **Single source of truth** — every notification visible to staff lives in `public.notifications`.
2. **Multi-channel delivery** — the same row is mirrored to (a) the in-app **Notification Bell**, (b) **Web Push** on every subscribed device, and (c) future channels (SMS, email) without changing producer code.
3. **One router, every surface** — in-app, push payload, and SW click all open the same destination.
4. **Additive, never blocking** — Web Push failures must not affect in-app delivery.
5. **Graceful degradation** — every failure mode shows a meaningful status to the user.

---

## 2. Component Map

```
Producer (any feature, e.g. abandoned-lead trigger, payment received, ...)
        │
        ▼
public.notifications  ───────────────────────────►  Realtime channel  ─► Notification Bell
        │                                           BroadcastChannel  ─► Other tabs (mark read sync)
        │
        ▼  (DB trigger: notifications_dispatch_push)
/api/public/push-dispatch  (Tanstack Start server route)
        │  web-push + VAPID keys
        ▼
push_subscriptions  ─►  Browser Push Service  ─►  /sw.js  ─►  showNotification()
                                                       │
                                                       ▼ (click)
                                            resolveNotificationRoute()  ─►  Booking / Draft / Customer / Follow-ups
```

### Files

| Layer            | Files |
| ---------------- | ----- |
| Routing resolver | `src/lib/notification-routing.ts` (single source of truth) |
| In-app API       | `src/lib/notifications-api.ts` |
| Bell UI          | `src/components/notification-bell.tsx` |
| Push hook        | `src/hooks/use-push-notifications.ts` |
| Push persistence | `src/lib/push-subscriptions.functions.ts` |
| Push admin       | `src/lib/push-admin.functions.ts` |
| Push config      | `src/lib/push-config.ts` (VAPID public key + b64 helpers) |
| Service worker   | `public/sw.js` |
| Dispatcher       | `src/routes/api/public/push-dispatch.ts` |
| Settings UI      | `src/routes/_authenticated/settings.general.tsx` (Push card + Admin card) |
| DB trigger       | migration `notifications_dispatch_push` |

---

## 3. Notification Routing (Single Source of Truth)

Every consumer **must** route through `resolveNotificationRoute()` in `src/lib/notification-routing.ts`. It implements the priority order:

1. **Booking** (`entity_type=booking` or `metadata.booking_id`) → `/bookings/:id`
2. **Draft Booking** (`metadata.draft_booking_id`) → `/bookings/:id/edit`
3. **Specialised entity** (`customer`, `complaint`, `payment`, `review`, `night_audit`)
4. **Customer profile** (`metadata.customer_id`) → `/customers/:id`
5. **Follow-ups** workspace — final fallback only

The Push dispatcher pre-resolves the URL into the payload, so the SW click handler simply opens `payload.url` — no resolver duplication in the SW (which couldn't import modules anyway).

When adding a new notification type, do **not** add a new switch case anywhere. Set the right `entity_type` / `metadata` and the routing is automatic.

---

## 4. Realtime Lifecycle (Bell)

The bell subscribes to `postgres_changes` on `public.notifications` via Supabase Realtime. Lifecycle rules to prevent the `"cannot add callbacks after subscribe()"` error:

1. **Unique topic per component instance.** Use `notifications-bell-${userId}-${Date.now()}` so two mounted bells (e.g. mobile + desktop in dev tools) never collide.
2. **Wrap `.on()` registration in `try/catch`.** A late re-render must not crash the bell.
3. **Always `removeChannel()` on unmount.**
4. **Mirror updates over `BroadcastChannel`** named `excella-notifications` so other tabs reflect Mark-Read / Dismiss without a refetch.

---

## 5. Push Lifecycle (`use-push-notifications.ts`)

The hook walks an explicit state machine. Every transition is observable in the diagnostics panel under **Settings → General → Push Notifications**.

```
idle ─► checking ─┬─► unsupported          (no SW / no PushManager / no Notification)
                  ├─► insecure_context     (not https / not localhost)
                  ├─► vapid_invalid        (missing VAPID_PUBLIC_KEY)
                  ├─► permission_denied    (browser block)
                  ├─► permission_default ─► requesting ─► (granted/denied)
                  └─► enabled              (already subscribed)

(on Enable click)
  permission_default ─► requesting ─► registering_sw ─► subscribing ─► persisting ─► enabled
                                          │                 │              │
                                          ▼                 ▼              ▼
                                       sw_failed     subscribe_failed   persist_failed
```

### Status copy

`statusCopy()` in `settings.general.tsx` maps every status to (a) a human label, (b) a tone (ok/warn/bad), and (c) a remediation hint. The app **never** shows a generic "temporarily unavailable" — if it fails, the operator sees exactly which step failed and what to do.

### Browser compatibility notes

- **Safari 16.4+** requires the page be installed as a PWA on iOS for Push to actually deliver. We surface the subscription state honestly; the user is told if their browser is supported.
- Some Chromium builds reject `applicationServerKey` if it's a typed-array view; we always pass a fresh `ArrayBuffer`.
- `InvalidStateError` on subscribe usually means a stale subscription with mismatched keys — we unsubscribe and retry once automatically.

---

## 6. Configuration

### Environment variables (server-side, **required**)

| Var | Purpose |
|-----|---------|
| `VAPID_PUBLIC_KEY`       | Identifies the application server to push services. Embedded in the client bundle. |
| `VAPID_PRIVATE_KEY`      | Signs push messages. Server-only. |
| `VAPID_SUBJECT`          | `mailto:...` identifier required by web-push. |
| `PUSH_DISPATCH_SECRET`   | Shared secret between DB trigger and the dispatcher route. |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | Used by `client.server.ts` for the dispatcher. |

### `public.app_settings` rows (filled via UI)

| Key                     | Source       | Purpose |
|-------------------------|--------------|---------|
| `push_dispatch_url`     | Settings UI  | Fully-qualified URL of `/api/public/push-dispatch` for this environment. |
| `push_dispatch_secret`  | Settings UI  | Mirrors `PUSH_DISPATCH_SECRET` for the trigger's `pg_net` call. |

The DB trigger `notifications_dispatch_push` reads both and posts to the URL with the secret in the `x-dispatch-secret` header.

### One-click configuration

**Settings → General → Push Dispatch (Admin)** offers an **Auto-configure dispatcher** button. It calls `configurePushDispatch({ origin: window.location.origin })` which:

1. Validates that `VAPID_*` and `PUSH_DISPATCH_SECRET` exist on the server.
2. Writes `push_dispatch_url = <origin>/api/public/push-dispatch` to `app_settings`.
3. Mirrors `PUSH_DISPATCH_SECRET` into `push_dispatch_secret`.

Run this exactly once per environment after deployment.

---

## 7. Deployment Checklist

- [ ] Set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `PUSH_DISPATCH_SECRET` server env vars.
- [ ] Deploy.
- [ ] Sign in as an admin.
- [ ] Open **Settings → General → Push Dispatch (Admin)**.
- [ ] Verify all three "Dispatcher" status lines are green.
- [ ] Click **Auto-configure dispatcher**.
- [ ] Click **Send test notification** — should appear in the bell within ~1s and on this device's OS notification tray within ~3s.
- [ ] On another device, sign in and enable push from **Settings → General → Push Notifications**.
- [ ] Re-send a test from device A — device B should receive a push.
- [ ] Click the push notification — should land on the configured URL (test notifications open the home dashboard).

---

## 8. Subscription Lifecycle

- **Create** — `pushManager.subscribe()` returns a subscription. The endpoint + keys are upserted into `push_subscriptions` (RLS-scoped to the owning user).
- **Refresh resilience** — on every mount, the hook calls `pushManager.getSubscription()` and reflects state. A page refresh never drops the subscription as long as the SW is registered.
- **Logout** — `signOut()` should call `disable()` so the device is unsubscribed and the DB row removed. Other tabs receive the BroadcastChannel signal and update.
- **Login** — first mount probes capability; if permission is already `granted` and no subscription exists, the user clicks **Enable** to recreate it.
- **Multiple devices** — each `push_subscriptions` row is a separate subscription. Notifications fan out to all of them.
- **Multiple tabs (same device)** — only one subscription per browser; both tabs share it. The bell uses `BroadcastChannel` to sync mark-read/dismiss state across tabs.
- **Endpoint expiry (404/410 on send)** — the dispatcher prunes the row automatically; the device re-subscribes on next mount.

---

## 9. Recovery & Fallback Behaviour

| Failure mode | What the operator sees | Recovery |
|--------------|------------------------|----------|
| Browser unsupported | "Browser unsupported" status | Use Chrome/Edge/Firefox/Safari 16.4+. In-app bell still works. |
| Permission denied   | "Browser permission denied" + remediation | User opens site settings → Allow → reload. |
| SW registration failed | "Service worker registration failed" + retry hint | Hard reload; avoid incognito. |
| Subscribe failed (stale sub) | "Subscription creation failed" | Click Disable → Enable. Hook auto-retries `InvalidStateError`. |
| Persist failed | "Could not save subscription" | Check internet; sign out/in. |
| Dispatcher unreachable | DB trigger logs `failed_to_dispatch`, in-app bell still works. | Admin re-runs **Auto-configure dispatcher**. |
| VAPID keys missing on server | Dispatcher returns `{ok:false, error:"vapid_not_configured"}` | Set env vars; redeploy. |

**Push is always additive.** If the dispatcher fails, the `notifications` row still exists; the bell still shows it; the user can still act on it.

---

## 10. VAPID Key Rotation

VAPID keys are long-lived but must occasionally be rotated.

1. Generate new pair: `npx web-push generate-vapid-keys`.
2. Set the new `VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY` as **secondary** env vars (keep old ones live).
3. Update `VAPID_PUBLIC_KEY` exposed to the client → client will create new subscriptions on next probe.
4. Run a 24-hour grace period where the dispatcher tries to send with the **new** key; subscriptions with old keys will fail with 410 and be pruned.
5. Remove the old keys.

Alternative: simpler "big-bang" rotation — change keys, redeploy, every device re-subscribes on next page load. Acceptable when active install base is small.

---

## 11. Adding a New Notification Type

1. **Producer** — anywhere in the app (server fn, DB trigger, edge function):
   ```ts
   await supabase.from("notifications").insert({
     type: "booking_paid",
     title: "Payment received",
     body: `${guest.name} paid ₹${amount}`,
     entity_type: "booking",
     entity_id: bookingId,
     metadata: { customer_id: customerId },
     audience_role: "reception",
   });
   ```
2. **Routing** — set `entity_type` + `entity_id` and the central resolver will route the bell, the push, and the SW click to `/bookings/:id`.
3. **No UI changes needed.** No new switch case, no SW edit, no dispatcher edit.

For richer fallback context, include `metadata.customer_id` (so a follow-up arrival still lands on a profile, not a list).

---

## 12. Operational Tools (deferred to next shipment)

Tracked but **not** yet implemented:

- Push Subscription Dashboard (per-user list of devices, last seen, revoke)
- Last Successful Push Delivery timestamps
- Notification Delivery Logs table
- Revoke Current Device / Revoke All Devices
- Send Test Push from arbitrary user context

The current admin card already covers Send Test Notification and dispatcher config status — enough for production rollout.

---

## 13. Things to Watch (post-release)

- **iOS PWA install prompt** — Safari iOS requires "Add to Home Screen" before push will actually deliver. Consider a soft prompt in the settings card.
- **Quiet hours** — currently always-on. Future: per-user mute window stored on `profiles`.
- **Per-type opt-out** — currently all-or-nothing. Future: a category matrix in user settings.
