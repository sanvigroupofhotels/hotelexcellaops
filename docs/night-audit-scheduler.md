# Night Audit — Automatic Scheduler (v1.1 Production Hardening)

## One engine, two triggers

| Trigger | Entry point | Engine |
|---|---|---|
| Reception (manual) | Night Audit → Review → Close Session | `closeSession()` in `src/lib/night-audit-sessions-api.ts` |
| Automatic (06:00 IST) | `POST /api/public/night-audit-run` | `runScheduledNightAudit()` → **the same** `openOrResumeSession()` + `closeSession()` |

`runScheduledNightAudit()` (`src/lib/night-audit-scheduler.ts`) contains **no
audit logic**. It is an orchestrator: idempotency guard → pending-work gate →
shared engine → telemetry. Any change to audit rules is made once, in
`closeSession()`, and both triggers inherit it.

## Injectable DB handle

The shared engines resolve their Supabase client through `db()`
(`src/lib/db.ts`) instead of importing the browser client. The cron route wraps
the call in `withDb(supabaseAdmin, …)`, so the exact same code runs with the
service-role client server-side and with the RLS client in the browser.

Engines already converted: `night-audit-api`, `night-audit-sessions-api`,
`activity-log`, `hk-generator`, `hk-tasks`, `hk-status`.

> The override is scoped to a single-flight server task (cron / webhook). Do not
> use `withDb` for concurrent per-user request handling.

## Schedule

`pg_cron` job `heos-night-audit-6am-ist` → `30 0 * * *` UTC = **06:00 IST**,
POSTing to `/api/public/night-audit-run` with the publishable key in the
`apikey` header. Manage it under **More → Cloud → Jobs**.

## Outcomes

| Status | HTTP | Meaning |
|---|---|---|
| `advanced` | 200 | Business Date moved forward (1..7 days of catch-up) |
| `already_current` | 200 | Business Date already equals today (IST) — no-op |
| `already_ran` | 200 | An automatic run already closed this Business Date — no-op |
| `blocked` | 409 | Pending check-ins / check-outs exist; Business Date untouched |
| `failed` | 409/500 | Unexpected error; Business Date untouched |

## Invariants

1. Business Date advances **only** on success, one day at a time, each via a
   real session close (decision rows + EOD totals + HK generation).
2. It can never exceed today's Asia/Kolkata calendar date (app guard + the
   `app_settings_guard_business_date` DB trigger).
3. Idempotent: repeat POSTs are no-ops (`night_audit_runs` guard on
   `mode='auto' + previous_business_date`).
4. Fully logged: a `night_audit_runs` row per attempt plus activity-log events
   (`night_audit_scheduler_completed` / `_blocked` / `_failed`) with a shared
   `correlation_id` and duration telemetry.
5. Catch-up is bounded to 7 days per invocation to avoid unbounded loops.

## Regression coverage

`tests/night-audit-scheduler.test.ts` — IST date resolution, single-day
advance, `already_current`, idempotency, blocking on pending check-ins and
check-outs, multi-day catch-up, telemetry shape.

## Legacy room-model cleanup (same milestone)

- `hk-generator.ts` now derives occupied rooms from
  `booking_room_assignments` segments (`start_date ≤ BD < end_date`) instead of
  `bookings.room_id`.
- `dues.tsx` resolves room labels from occupancy segments (segment covering the
  Business Date, else the latest segment).
