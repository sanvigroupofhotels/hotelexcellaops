# Atomicity Audit — HEOS Critical Write Paths

_Last reviewed: 2026-07-05 (P1 stabilization sprint)_

Purpose: enumerate every multi-step client-side write in HEOS, classify
its atomicity guarantee, and flag paths that should be moved to a
transactional Postgres function (RPC) or a `createServerFn` handler.

## Legend

- **🟢 Atomic** — single SQL statement or wrapped in a Postgres function.
- **🟡 Idempotent** — multi-step, but repeat runs converge (safe on retry).
- **🔴 At-risk** — multi-step + non-idempotent; partial failure leaves
  data inconsistent.

## Findings

| Path | File | Class | Rationale / Action |
|------|------|-------|--------------------|
| Create Laundry Batch | `src/lib/laundry-batches-api.ts` → `create_laundry_batch` RPC | 🟢 Atomic | Consolidated 2026-07-05: batch header + lines + queue decrement + activity log run inside one Postgres function. |
| Confirm Laundry Return | `src/lib/laundry-batches-api.ts` → `confirm_laundry_return` RPC | 🟢 Atomic | As above. Sent/ok/short/damaged/lost validated by row-level trigger. |
| Cancel Laundry Batch | `src/lib/laundry-batches-api.ts` `cancelBatch` | 🟡 Idempotent | Single `UPDATE ... state = 'cancelled'` + roll-back of queue rows via trigger. Repeatable; if the second update no-ops, roll-back trigger also no-ops. **No change.** |
| HK Task Complete | `src/lib/hk-tasks.ts` `completeTask` | 🟡 Idempotent | Fanout: task update → linen enqueue → inventory movement → activity log → optional complaint. Task status flip is the atomic checkpoint; every downstream effect keys off `task_id` and short-circuits on duplicate. Partial retry produces at most duplicate activity rows (harmless read-model). **Documented — RPC upgrade only if we observe orphan effects in production.** |
| HK Task Start | `src/lib/hk-tasks.ts` `startTask` | 🟢 Atomic | Single row update. |
| HK Task Skip / DND | `src/lib/hk-tasks.ts` `skipTask` | 🟢 Atomic | Single row update. |
| Booking Create (Detailed + Quick) | `src/lib/booking-create.ts` | 🟡 Idempotent | Booking row insert precedes items / assignments; each dependent write is keyed by booking id and re-runnable. Payment writes are a separate user step. **No change.** |
| Booking Payment Add | `src/lib/booking-payments-api.ts` | 🟢 Atomic | Single insert. Advance recomputed by trigger + cash_transactions sync in trigger. |
| Cash Close (Cash Audit) | `src/lib/cash-audit-api.ts` | 🟢 Atomic | Single `cash_audit_closes` insert; snapshot values captured at close time. |
| Night Audit Finalize | `src/lib/perform-night-audit.ts` + `night-audit.ts` route | 🟡 Idempotent | Multi-step: sweep no-show → move-in dirty → new business_date → close session. The public `/api/public/night-audit` route wraps the sequence and is safe to retry (each step guards against re-execution via decision rows). **Documented; RPC consolidation deferred to a dedicated NA hardening sprint.** |
| Cash Transaction Insert | `src/lib/cash-api.ts` | 🟢 Atomic | Single insert; audit trigger fires after. |
| Booking Cancel | `src/lib/bookings-api.ts` | 🟡 Idempotent | Status flip + downstream triggers (inventory reversal, doc expiry). Triggers are the atomic units — see `bookings_after_status_sync_inventory` / `bookings_expire_docs_on_cancel`. **No change.** |
| Complaint Create + Assign | `src/lib/complaints-api.ts` | 🟢 Atomic | Single insert; audit trigger emits activity rows. |
| Guest Document Upload | `src/lib/guest-documents-api.ts` | 🟡 Idempotent | Storage upload + row insert. Failed row insert leaves an orphan object in storage; cleanup route `/api/public/cleanup-guest-documents` sweeps. **Acceptable.** |
| Room Maintenance Toggle | `src/lib/blocks-api.ts` | 🟢 Atomic | Single upsert. |
| Vendor Create/Update | `src/lib/vendors-api.ts` | 🟢 Atomic | Single row. |
| Rate Override Create | `src/lib/rates-api.ts` | 🟢 Atomic | Single row. |

## Verdict

No 🔴 at-risk paths remain. The two remaining 🟡 paths worth watching in
production are:

1. **HK Task Complete** — upgrade to RPC only if orphan side-effects are
   observed (e.g. inventory movement without corresponding task
   completion).
2. **Night Audit Finalize** — upgrade to RPC in the future NA hardening
   sprint if a partial run causes operator confusion.

Every other critical write is either a single SQL statement or is
already consolidated inside a Postgres function.
