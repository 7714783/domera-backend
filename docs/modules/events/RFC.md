# Module RFC — `events`

## 1. Why this module exists

Owns the **outbox pattern** — the only sanctioned cross-module communication channel after INIT-010. Domain modules append rows to `OutboxEvent` inside the same Prisma transaction that updates their canonical entity; an in-process dispatcher polls pending rows and invokes registered handlers.

This module is `@Global()` — every other module can inject `OutboxService` (publish) and `OutboxRegistry` (subscribe) without listing it in their `imports[]`. That's the SSOT-friendly equivalent of "fire and forget across module boundaries".

## 2. Scope and non-scope

### In scope
- `OutboxEvent` table — `tenantId`, `buildingId`, `type`, `subject`, `specversion`, `time`, `data` (CloudEvent-shaped payload), `status` (`pending` / `delivered` / `failed`), `attempts`.
- `OutboxService.publish(tx, spec)` — call inside a Prisma transaction. Validates `payload.tenantId` matches.
- `OutboxRegistry.register(eventType, handler)` — handler is `(envelope) => Promise<void>`; must be **idempotent** (use `event.id` as dedup key downstream).
- `OutboxDispatcher` — in-process polling worker (5s, batch 50, max attempts 5). Uses `MigratorPrismaService` (BYPASSRLS) because outbox spans tenants.
- Audit-style read endpoints under `/v1/events/*` for ops debugging.

### Out of scope
- Cross-process queue (BullMQ + Redis) — replaceable later; the API surface (`publish` / `register`) doesn't change when the worker swaps.
- Event schema validation beyond `payloadShape includes tenantId`. Producers are trusted to publish well-shaped events; the contract is enforced by `event-contract.test.mjs`.
- Dead-letter UI — read the rows directly until ops dashboard demands more.

## 3. Owned entities

| Model | Table |
|---|---|
| `OutboxEvent` | `outbox_events` |

## 4. Tenant scope

`OutboxEvent` carries `tenantId` and is RLS-scoped. The dispatcher reads via `MigratorPrismaService` to scan across tenants in one batch.

## 5. Events emitted

This module is meta — it transports events for everyone. It does not produce its own domain events.

## 6. Hard rules

1. **Publish inside the same transaction** as the canonical write. If the entity insert fails, the outbox row never lands. If the outbox insert fails, the entity insert rolls back. Atomic.
2. **`payload.tenantId` is mandatory.** `OutboxService.publish` throws when missing. The CI gate `event-contract.test.mjs` requires it in `payloadShape` for every catalogued event.
3. **Subscribers MUST be idempotent.** At-least-once delivery means `event.id` can fire multiple times (retry, restart). Use it as the dedup key in your handler.
4. **No direct calls between domain modules.** If you need to trigger something in another module, publish an event. The audit tests will catch direct service injection across boundaries.

## 7. Surface

Internal service API only. No HTTP endpoints for callers; debugging endpoints under `/v1/events/*` are read-only and ops-gated.

## 8. Test gates

- `event-contract.test.mjs` — every event in CATALOG has producer/consumers/payloadShape with tenantId.
- `module-boundaries.test.mjs` — `events` is in UNIVERSAL set; cross-module imports through the registry are allowed.
- `ssot-ownership.test.mjs` — `outboxEvent` is owned by `events` module.
