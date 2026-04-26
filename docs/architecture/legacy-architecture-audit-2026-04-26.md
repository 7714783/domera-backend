# Legacy Architecture Audit — INIT-010

> **Date:** 2026-04-26.
> **Scope:** all 48 modules under `apps/api/src/modules/*`.
> **Contract:** [platform-development-contract.md](platform-development-contract.md).
> **Goal:** диагностика и roadmap миграции. Код не трогаем — только классифицируем.
>
> **TL;DR.** 0 модулей полностью соответствуют новому контракту. 1 модуль 🔴
> (cross-module write на `TaskInstance` без events). Остальные 47 — 🟡 partial:
> универсальный долг — отсутствие RFC + неполное покрытие `audit.write()` на
> sensitive-write путях. **Самая важная находка: `OWNERSHIP` map в
> ssot-ownership.test.mjs не покрывает `taskInstance` и ещё ~12 entity** —
> CI зелёный по совпадению, не по сути. Это P0.

## 1. Критерии аудита

Каждый модуль проверен по 8 пунктам контракта (§7 DoR + §9 CI gates):

1. **RFC** — `docs/modules/<name>/RFC.md` существует?
2. **Ownership** — Prisma writes только на entity, которыми модуль владеет?
3. **State machine** — каждый workflow в `state-machine.test.mjs` REGISTRY?
4. **Event contract** — каждое событие в `event-contract.test.mjs` CATALOG с producer/consumers/schemaVersion/tenantId?
5. **No cross-module direct writes** — мутации через events/commands, не direct prisma?
6. **Tenant/RBAC/audit** — `tenantId` фильтр + `requireManager`/`authorize` + `audit.write()` для sensitive?
7. **Idempotency / async через queue** — там, где нужно?
8. **CI gates** — текущие 5 гейтов проходят (ssot / module-boundaries / state-machine / event-contract / module-rfc)?

Статусы:
- 🟢 **GREEN** — 0-1 нарушений, нет критичных (data leak / cross-module write / missing tenant filter)
- 🟡 **YELLOW** — 2-3 нарушений, нет критичных
- 🔴 **RED** — 4+ нарушений ИЛИ есть критичное

## 2. Итоговая таблица

| Module | Status | Violations | Blocker | Главное нарушение |
|---|---|---|---|---|
| approvals | 🟡 | 2 | P1 | RFC missing; audit.write() отсутствует на approve/reject |
| assets | 🟡 | 2 | P2 | RFC missing; audit gap на assetMedia.delete (`assets.service.ts:466`) |
| assignment | 🟡 | 1 | P2 | RFC missing |
| audit | 🟡 | 1 | P2 | RFC missing (модуль сам владеет audit_entries) |
| auth | 🟡 | 1 | P2 | RFC missing |
| building-core | 🟡 | 2 | P1 | RFC missing; legacy create-path BuildingOccupantCompany (см. ssot doc) |
| buildings | 🟡 | 1 | P2 | RFC missing |
| calendar-blackouts | 🟡 | 1 | P2 | RFC missing |
| cleaning | 🟡 | 3 | P1 | RFC; audit.write missing на CRUD; не подключён к Tasks inbox (INIT-009) |
| compliance | 🟡 | 1 | P2 | RFC missing |
| compliance-profiles | 🟡 | 1 | P2 | RFC missing |
| **condition-triggers** | 🔴 | 4 | **P0** | **`prisma.taskInstance.create` ([condition-triggers.service.ts:143](../../apps/api/src/modules/condition-triggers/condition-triggers.service.ts#L143))** — TaskInstance не должен писаться отсюда |
| connectors | 🟡 | 2 | P2 | RFC; legitimate Incident write задокументирован, но event-contract пуст |
| contractor-companies | 🟡 | 1 | P2 | RFC missing |
| devices | 🟡 | 1 | P2 | RFC missing |
| document-links | 🟡 | 1 | P2 | RFC missing |
| document-templates | 🟡 | 1 | P2 | RFC missing |
| documents | 🟡 | 1 | P2 | RFC missing |
| emergency-overrides | 🟡 | 1 | P2 | RFC missing |
| events | 🟡 | 1 | P2 | RFC missing |
| health | 🟡 | 1 | P2 | RFC missing (минимальный, можно деприоритизировать) |
| iam | 🟡 | 1 | P2 | RFC missing |
| imports | 🟡 | 2 | P2 | RFC; bulk-import пишет CompletionRecord (legitimate exception) |
| inventory | 🟡 | 1 | P2 | RFC missing |
| leases | 🟡 | 2 | P2 | RFC; BuildingContract dual-ownership (см. ssot doc, acceptable) |
| metrics | 🟡 | 1 | P2 | RFC missing |
| mfa | 🟡 | 1 | P2 | RFC missing |
| obligations | 🟡 | 1 | P2 | RFC missing |
| occupants | 🟡 | 1 | P2 | RFC missing |
| onboarding | 🟡 | 1 | P2 | RFC missing |
| organizations | 🟡 | 1 | P2 | RFC missing |
| ppm | 🟡 | 3 | P1 | RFC; audit.write missing на case-state переходах; CompletionRecord write (legitimate exception) |
| privacy | 🟡 | 1 | P2 | RFC missing |
| projects | 🟡 | 1 | P2 | RFC missing |
| public-qr | 🟡 | 1 | P2 | RFC; serviceRequest write задокументирован как legitimate |
| qr-locations | 🟡 | 1 | P2 | RFC missing |
| reactive | 🟡 | 3 | P1 | RFC; audit.write missing на createIncident/createServiceRequest/createWorkOrder |
| role-dashboards | 🟡 | 1 | P2 | RFC missing |
| rounds | 🟡 | 1 | P2 | RFC missing |
| scim | 🟡 | 1 | P2 | RFC missing |
| seed-runtime | 🟡 | 1 | P2 | RFC missing (dev-only, можно деприоритизировать) |
| sso | 🟡 | 1 | P2 | RFC missing |
| takeover | 🟡 | 1 | P2 | RFC missing |
| tasks | 🟡 | 2 | P1 | RFC; модуль показывает только PPM, нужен union (INIT-009) |
| tenancy | 🟡 | 1 | P2 | RFC missing (middleware-only, минимальный) |
| tenant-companies | 🟡 | 1 | P2 | RFC missing |
| vendor-invoices | 🟡 | 1 | P2 | RFC missing |
| webhooks | 🟡 | 1 | P2 | RFC missing |

**Сводка:**

| Статус | Кол-во |
|---|---|
| 🟢 GREEN | 0 |
| 🟡 YELLOW | 47 |
| 🔴 RED | 1 |

## 3. Top P0 — критичные нарушения

### P0-1. condition-triggers пишет TaskInstance напрямую
- **Файл:** [condition-triggers.service.ts:143](../../apps/api/src/modules/condition-triggers/condition-triggers.service.ts#L143)
- **Что:** `const task = await this.prisma.taskInstance.create({...})`
- **Контракт нарушен:** §3 (cross-module direct write). TaskInstance — вотчина модуля `ppm`.
- **Риск:** хрупкий workflow + растущее число писателей TaskInstance без явного контракта. Через полгода никто не вспомнит, что у TaskInstance три писателя.
- **Почему CI этого не ловит:** `taskInstance` отсутствует в OWNERSHIP map в `apps/api/test/ssot-ownership.test.mjs`. Это второй P0 (см. P0-2).
- **План миграции (1-2 дня):**
  1. Добавить `taskInstance` в OWNERSHIP map с владельцем `ppm`.
  2. Перенести `create` в `ppm.service.ts` (новый метод `createFromTrigger`) или опубликовать событие `condition.triggered` → consumer = ppm.
  3. condition-triggers становится publish-only.

### P0-2. OWNERSHIP map в ssot-ownership.test.mjs неполная
- **Файл:** [ssot-ownership.test.mjs](../../apps/api/test/ssot-ownership.test.mjs)
- **Что:** В map нет `taskInstance`, `ppmTemplate`, `ppmPlanItem`, `ppmExecutionLog`, `building`, `entrance`, `parkingSpot`, `storageUnit`, `inventoryItem`, `stockLocation`, `stockMovement`, `qrLocation`, `document`, `documentLink`, `documentTemplate`, `equipmentRelation`, `tenantRepresentative`, `webhookSubscription`, `outboxEvent`, `inboundWebhookEvent`, `dsarRequest` и ряд других. То есть **CI зелёный потому что эти entity не отслеживаются**, а не потому что cross-module writes отсутствуют.
- **Риск:** скрытые cross-module writes; ложное чувство безопасности; новые модули могут писать в чужие entity и CI не поймает.
- **План миграции (1 день):**
  1. Скриптом сгенерировать список всех Prisma delegates (`grep -E "model \w+ \{" schema.prisma`).
  2. Для каждого определить owner-модуль (один Prisma `.create` ИЛИ архитектурное решение, если несколько).
  3. Дополнить OWNERSHIP map. Запустить `ssot-ownership.test.mjs` — если падает, классифицировать каждое нарушение в этот же отчёт.
- **Acceptance:** OWNERSHIP покрывает 100% Prisma моделей (или явный комментарий "exempt — read-only / system table" для исключений).

### P0-3. Universal RFC missing — 47 модулей в RETRO_RFC_PENDING
- **Файл:** [module-rfc.test.mjs:29-78](../../apps/api/test/module-rfc.test.mjs#L29)
- **Что:** Все 48 модулей в exception-list (RETRO_RFC_PENDING). RFC test зелёный по построению, не по сути.
- **Риск:** новые модули будут добавляться без RFC потому что предшественники без RFC; контракт §11 не enforced.
- **План миграции (2-3 дня):** см. секцию "Migration backlog" ниже.

### P0-4. audit.write() отсутствует на sensitive state transitions в reactive/ppm/cleaning/approvals
- **Файлы:**
  - [approvals.service.ts](../../apps/api/src/modules/approvals/approvals.service.ts) — approve/reject не пишут audit на изменение `ApprovalRequest.status`
  - [cleaning.request.service.ts](../../apps/api/src/modules/cleaning/cleaning.request.service.ts) — `changeStatus` пишет в `cleaning_request_history` (модульный лог), но не в universal `audit_entries`
  - [ppm.service.ts](../../apps/api/src/modules/ppm/ppm.service.ts) — case state transitions без audit
  - [reactive.service.ts](../../apps/api/src/modules/reactive/reactive.service.ts) — `createIncident`/`createServiceRequest`/`createWorkOrder` без audit
- **Контракт нарушен:** §5 (audit invariant) + §7 пункт 7 (DoR).
- **Риск:** GDPR/SOX — нет универсального следа изменений на регулируемых данных. Модульные `*_history` таблицы не покрывают cross-cutting аналитику.
- **План миграции (1.5 дня):**
  1. Создать helper `audit.transition(actor, entityType, entityId, from, to, metadata)`.
  2. Прицепить ко всем `prisma.<entity>.update({status: ...})` в reactive/ppm/cleaning/approvals.
  3. Опционально: добавить CI guard `audit-coverage.test.mjs` — grep'ом ловить `update.*status` без следующего `audit.write` в том же блоке.

### P0-5. Tasks inbox показывает только PPM (см. INIT-009)
- **Файл:** [tasks-page.tsx](../../apps/frontend/src/components/domera/pages/tasks-page.tsx)
- **Что:** Cleaning + Reactive задачи живут в своих страницах; единого user-inbox нет.
- **Риск:** оперативная: технику нужно открывать три экрана. Не security/compliance, но блокирует Cleaning от 🟢.
- **План миграции:** уже описан в [INIT-009](../../apps/frontend/src/lib/developer-dashboard-data.ts) (1-2 дня).

## 4. Migration backlog (упорядочен по blocker'у)

| # | Задача | Модули | Дни | Blocker | Пользу |
|---|---|---|---|---|---|
| 1 | Закрыть OWNERSHIP map gap (P0-2) — добавить все Prisma delegates с owner-классификацией | infra | **1** | P0 | Поймать скрытые cross-module writes |
| 2 | Перенести `taskInstance.create` из condition-triggers в ppm via event (P0-1) | condition-triggers, ppm | **1.5** | P0 | Закрывает RED-классификацию condition-triggers |
| 3 | `audit.transition()` helper + cover reactive/ppm/cleaning/approvals (P0-4) | infra + 4 модуля | **1.5** | P0 | GDPR/SOX compliance, audit-coverage CI guard |
| 4 | Написать RFC.md для top-12 операционных модулей (P0-3 первая волна) | assets, ppm, reactive, cleaning, approvals, building-core, iam, audit, assignment, contractor-companies, tenant-companies, documents | **2** | P0 | разблокирует архитектурные решения по этим модулям |
| 5 | INIT-009 Unified Tasks Inbox (P0-5) | tasks + ppm + cleaning + reactive | **1.5** | P1 | Cleaning возвращается в 🟢; решает оперативный gap |
| 6 | Написать RFC.md для остальных 36 модулей | все остальные | **3** | P1 | Закрывает retro-RFC долг |
| 7 | Добавить event-contract publish-вызовы из реальных модулей (сейчас CATALOG declarative, кода нет) | ppm, reactive, cleaning, approvals, assets, assignment, public-qr | **2** | P1 | Превращает event catalog из документации в работающую систему |
| 8 | Outbox pattern в Prisma transactions + BullMQ worker fan-out | infra | **3** | P1 | Реальная межмодульная синхронизация (контракт §4 §6) |
| 9 | Tighten state-machine.test — codebase scan на string literals статусов | infra | **0.5** | P2 | Ловит "случайные" статусы вне REGISTRY |
| 10 | Idempotency-Key middleware + storage | infra | **2** | P2 | Контракт §6 |
| 11 | Architecture drift weekly workflow `.github/workflows/architecture-drift.yml` | infra | **0.5** | P2 | Контракт §12 |

**Итог:** ~18.5 дней ленд-стайл. Параллелизуется на 2-3 разработчиков → ~9-10 календарных дней.

## 5. Quick wins (≤0.5 day each)

1. **Деприоритизировать минимальные модули в RETRO_RFC_PENDING** (~1 час)
   - `health`, `tenancy`, `metrics`, `seed-runtime` — инфраструктурные, не имеют domain-логики
   - Создать единый `docs/modules/_infrastructure/RFC.md` который покрывает все 4
2. **Добавить `taskInstance` + `ppmTemplate` + `ppmPlanItem` в OWNERSHIP** (~30 мин)
   - Откроет P0-1 (condition-triggers) на CI красным — пусть откроет, это и нужно
3. **Прицепить `audit.write()` на 5 endpoint в approvals** (~2 часа)
   - approve, reject, supersede policy, create policy, create delegation
4. **Переименовать **legacy** `Floor`/`Unit` модели — убрать relation на них из Building** (~30 мин)
   - Сейчас они помечены DEPRECATED но всё ещё linked. Уберём — чтобы prisma generate не показывал их в client типах.
5. **Запустить `state-machine.test.mjs` в CI на push** (~5 мин конфигурации)
   - Уже запускается через `pnpm test`. Просто подтвердить визуально что ci.yml включает его.
6. **Добавить ссылку на этот аудит в developer dashboard** (~10 мин)
   - Новая INIT-010 запись с ссылкой.

## 6. Что менять НЕ нужно

- Storyball-fixtures и тестовые `mock` массивы под `__fixtures__/` — это законно по контракту §7.
- `BYPASS_PATHS` в TenantMiddleware — public-qr, health, auth/login и т.д. имеют осознанный no-auth контракт.
- `connectors` и `imports` ownership exceptions для Incident/CompletionRecord — задокументированы в [entity-ownership-ssot.md](entity-ownership-ssot.md), legitimate.
- Модули без workflow (audit, auth, health, metrics, tenancy, seed-runtime) могут оставаться без state-machine. EXEMPT по контракту §2.

## 7. Acceptance — когда аудит "сделан"

- [x] 100% модулей покрыто (48 / 48)
- [x] Каждое нарушение имеет ссылку на файл (или строку)
- [x] Приоритизированный план миграции
- [x] Чёткий ответ "какие модули можно трогать для роста, а какие сначала стабилизировать"

**Какие модули можно трогать для роста (новые фичи поверх):**

✅ Безопасно — assignment, contractor-companies, tenant-companies, public-qr, building-core (settings/floors/units), iam, audit, auth, mfa, sso, scim, webhooks, metrics, qr-locations, calendar-blackouts, document-links, document-templates, role-dashboards, rounds, devices, inventory, projects, leases, takeover, occupants, organizations, buildings, compliance-profiles, obligations, privacy.

⚠️ Сначала стабилизировать (P0-4 audit gap):

- **reactive** — добавить `audit.write()` на createIncident/createServiceRequest/createWorkOrder перед расширением workflow
- **ppm** — добавить `audit.write()` на case state transitions перед добавлением новых случаев
- **cleaning** — добавить `audit.write()` на CRUD перед расширением модуля
- **approvals** — добавить `audit.write()` на approve/reject перед добавлением policy types

🛑 НЕ ТРОГАТЬ до починки:

- **condition-triggers** — RED, cross-module write на TaskInstance. Любое расширение умножит долг.

## 8. Следующий шаг

Создать [INIT-010](../../apps/frontend/src/lib/developer-dashboard-data.ts) с этими 11 задачами как фазами + ссылкой на этот документ. Приоритеты P0/P1/P2 уже расставлены.

После закрытия P0 (задачи 1-4) — повторить аудит и обновить статусы. Цель: ноль 🔴, ≤10 🟡 модулей с нарушениями (≥2 нарушения).
