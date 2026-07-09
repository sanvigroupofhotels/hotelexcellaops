# HEOS Core v1.0 — Module Dependencies

How modules interact at runtime. Arrows point from **caller** to
**callee** or **emitter** to **consumer**.

```mermaid
flowchart TD
    BE[Booking Engine public]
    B[Booking]
    GP[Guest Portal]
    HV[House View]
    HK[Housekeeping]
    LA[Laundry]
    CA[Cash Book]
    NA[Night Audit]
    RE[Reporting]
    NO[Notifications]
    CU[Customers]
    MA[Master Data]
    UA[User Access]
    CO[Complaints]
    IN[Inventory & Vendors]
    ST[Staff]
    AL[Activity Log]
    BD[Business Date]

    BE --> B
    B --> CU
    B --> MA
    B --> CA
    B --> HK
    B --> NO
    B --> AL
    GP --> B
    GP --> NO
    HV --> B
    HV --> HK
    HK --> LA
    HK --> AL
    HK --> NO
    LA --> IN
    LA --> AL
    CA --> B
    CA --> MA
    CA --> AL
    NA --> B
    NA --> HK
    NA --> CA
    NA --> BD
    NA --> AL
    CO --> B
    CO --> NO
    CO --> AL
    RE --> B
    RE --> HK
    RE --> LA
    RE --> CA
    RE --> NA
    RE --> ST
    RE --> AL
    UA -.gates.-> B
    UA -.gates.-> HK
    UA -.gates.-> LA
    UA -.gates.-> CA
    UA -.gates.-> NA
    UA -.gates.-> RE
    BD -.pivots.-> B
    BD -.pivots.-> HK
    BD -.pivots.-> CA
    BD -.pivots.-> NA
    BD -.pivots.-> RE
```

## Ownership

- **Booking** owns booking lifecycle. Every module reads booking state;
  only Booking writes it.
- **Housekeeping** owns HK task lifecycle. Only the checkout hook
  (owned by Booking) enqueues tasks.
- **Laundry** consumes HK-completed rows via `laundry_queue`.
- **Cash Book** owns cash ledger; only Booking (via payments) and
  operators (via expenses) write.
- **Night Audit** is the only writer of Business Date (via
  `app_settings`).
- **Notifications** is fan-out only — never mutates business state.
- **Activity Log** is append-only. Every module writes; only Reporting
  reads.

## Forbidden couplings

The following couplings are architectural violations. Fix on sight.

1. Any screen writing to `housekeeping_tasks` outside `hk-*` engine.
2. Any screen advancing `business_date` outside Night Audit.
3. Any module sending push/email directly instead of via
   `notification-engine.ts`.
4. Any screen reading/writing deprecated `quotes*` / `followups`.
5. Cross-module joins in reporting that bypass `reporting/*` helpers.

## Real-time subscriptions

House View, Housekeeping, and Laundry subscribe to Supabase Realtime.
New realtime channels should be added via `use-realtime.ts` — do not
open raw channels from components.
