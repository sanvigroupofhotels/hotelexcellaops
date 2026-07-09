# HEOS → Excella AI OS — Agent Roadmap

Guides how future AI agents will safely interact with HEOS. Every agent
follows three rules:

1. **Read via shared engines**, never raw tables — engines enforce
   business invariants and audit logging.
2. **Write via approval workflows** — agents propose actions; humans
   approve unless the action is explicitly whitelisted for autonomy.
3. **RLS is the security floor.** Agents run under a service account
   with narrowly-scoped role permissions; RLS enforces what that
   service account can actually mutate.

## Agent inventory

For each: primary data sources, engines used, read scope, suggested
write scope, approval workflow, future automations.

---

### 1. Executive AI (Owner Copilot)

- **Sources.** `bookings`, `booking_payments`, `cash_transactions`,
  `activity_log`, `owner-dashboard.functions.ts` output.
- **Engines.** Reporting engines, Owner Dashboard function.
- **Reads.** All KPIs, occupancy, ADR, RevPAR, cash summary, incident
  digest.
- **Writes (proposed).** None — advisory only.
- **Approvals.** N/A.
- **Automations.** Daily owner brief; anomaly detection.

### 2. Revenue Manager AI

- **Sources.** `bookings`, `room_rates`, `rate_overrides`,
  `promo_codes`, `external_bookings`, `guest_reviews`.
- **Engines.** Pricing, availability, rates-api.
- **Reads.** Pickup, pace, competitor rates (via integration), demand
  signals.
- **Writes (proposed).** `rate_overrides` (proposed for approval),
  `promo_codes` (proposed).
- **Approvals.** Owner or admin approves every rate change.
- **Automations.** Suggest weekly rate plan; auto-tune LOS rules
  post-approval.

### 3. Operations AI

- **Sources.** `bookings`, `housekeeping_tasks`, `laundry_batches`,
  `complaints`, `activity_log`.
- **Engines.** Booking, HK, Laundry.
- **Reads.** Arrivals, in-house, checkouts, HK backlog, laundry queue,
  open complaints.
- **Writes (proposed).** Reassign HK tasks; escalate complaints.
- **Approvals.** Manager approves reassignments over N tasks.
- **Automations.** Auto-generate service tasks from arrival prefs.

### 4. Housekeeping AI

- **Sources.** `housekeeping_tasks`, `housekeeping_room_exceptions`,
  `staff_attendance`.
- **Engines.** HK, Staff HR.
- **Reads.** Task board, staff availability, historical throughput.
- **Writes (proposed).** Optimal task assignment order.
- **Approvals.** HK supervisor.
- **Automations.** Predict turnaround per room type; auto-order tasks
  by SLA risk.

### 5. Laundry AI

- **Sources.** `laundry_batches`, `laundry_batch_lines`,
  `laundry_queue`, `vendors`.
- **Reads.** Vendor performance, loss/damage rates, turnaround.
- **Writes (proposed).** Suggested vendor for next batch; loss-pattern
  alerts.
- **Approvals.** Admin approves vendor swap.

### 6. Inventory AI

- **Sources.** `inventory_items`, `inventory_movements`, `vendors`.
- **Reads.** Stock levels, consumption rates, reorder points.
- **Writes (proposed).** Draft purchase orders.
- **Approvals.** Admin approves each PO.
- **Automations.** Reorder alerts to procurement channel.

### 7. Procurement AI

- **Sources.** `vendors`, `inventory_movements`, `cash_transactions`.
- **Reads.** Vendor history, price trends, payment history.
- **Writes (proposed).** Vendor scorecards; recommended vendors.
- **Approvals.** Admin/owner.

### 8. Finance AI

- **Sources.** `cash_transactions`, `booking_payments`,
  `salary_payments`, `salary_advances`, `expense_types`.
- **Reads.** Daily cash summary, expense breakdown, salary run,
  outstanding dues.
- **Writes (proposed).** Draft cash close narrative; flag anomalies.
- **Approvals.** Owner approves cash close as today.

### 9. Marketing AI

- **Sources.** `customers`, `leads`, `guest_reviews`, `bookings`,
  external campaign integrations.
- **Reads.** Guest segments, LTV, campaign ROI.
- **Writes (proposed).** Segment lists; campaign drafts via
  notification engine.
- **Approvals.** Owner approves campaigns before send.

### 10. CRM AI

- **Sources.** `customers`, `bookings`, `complaints`,
  `crm_outbound_emails`.
- **Reads.** Guest history, preferences, complaint history.
- **Writes (proposed).** Draft personalised outreach; birthday /
  anniversary schedules.
- **Approvals.** Admin.

### 11. Review Management AI

- **Sources.** `guest_reviews`, external review platforms.
- **Reads.** Review sentiment, response history.
- **Writes (proposed).** Draft review responses.
- **Approvals.** Owner approves each response.

### 12. Customer Experience AI (Guest Concierge)

- **Sources.** `bookings`, `guest_documents`, portal usage, complaints,
  in-house charges.
- **Reads.** Live in-house guest state.
- **Writes (proposed).** Send targeted portal nudges; recommend
  upgrades; log requests.
- **Approvals.** Auto-run for whitelisted actions (send info card);
  human approval for money-affecting actions.

---

## Common contracts

- **Read endpoint.** Every agent reads via existing `createServerFn`
  functions (typed, audited). No agent gets raw SQL.
- **Write endpoint.** Every proposed write lands in a new
  `agent_actions` table (future) with `agent_id`, `action_type`,
  `payload`, `status = pending|approved|rejected|executed`. Only after
  approval does an engine execute the action.
- **Audit.** Every agent read and every proposed write logs to
  `activity_log` with `actor_id = <agent-service-account>`.

## Prerequisites before enabling agents

1. `agent_actions` table + approval UI.
2. Service accounts + role scoping per agent.
3. Rate limiting on agent-facing server functions.
4. Explicit whitelist of autonomous actions per agent.

The current v1.0 architecture already supports these without redesign
— agents plug into the same engines humans use.
