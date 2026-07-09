# HEOS Core v1.0 — Documentation Index

Post-Shipment 3B baseline. This folder is the single source of truth for
future development and AI-assisted work.

## Architecture & governance
- [`architecture.md`](./architecture.md) — Overall system, layers, principles.
- [`architecture-health.md`](./architecture-health.md) — Known debt (non-blocking).
- [`developer-guide.md`](./developer-guide.md) — Conventions & onboarding.
- [`production-readiness.md`](./production-readiness.md) — Per-module status.

## Modules & data
- [`modules.md`](./modules.md) — Every operational module.
- [`shared-engines.md`](./shared-engines.md) — Cross-cutting engines.
- [`module-dependencies.md`](./module-dependencies.md) — Runtime dependencies.
- [`database.md`](./database.md) — Every table.
- [`database-er.md`](./database-er.md) — ER diagram (Mermaid).

## Workflows & UX
- [`workflows.md`](./workflows.md) — Business lifecycles.
- [`navigation.md`](./navigation.md) — Sidebar, routes, role visibility.
- [`permissions.md`](./permissions.md) — Full role × permission matrix.

## Events, notifications, integrations
- [`events.md`](./events.md) — Business event catalogue.
- [`notifications.md`](./notifications.md) — In-app notification impl.
- [`notification-architecture.md`](./notification-architecture.md) — Channel adapter contract + audience matrix.
- [`integration-readiness.md`](./integration-readiness.md) — External integration roadmap.

## AI
- [`ai-readiness.md`](./ai-readiness.md) — Event catalogue + engines for AI.
- [`ai-roadmap.md`](./ai-roadmap.md) — 12 planned agents; read/write scopes.

## Audits
- [`atomicity-audit.md`](./atomicity-audit.md) — Transactional guarantees.
- [`booking-parity.md`](./booking-parity.md) — Booking flow parity.

## Update policy
Every migration that changes schema, permissions, or roles MUST update
the corresponding doc(s) in the same PR:
- schema change → `database.md`, `database-er.md`
- permission change → `permissions.md`
- new module → `modules.md`, `navigation.md`, `module-dependencies.md`
- new event → `events.md`, `notification-architecture.md`, `ai-roadmap.md`
