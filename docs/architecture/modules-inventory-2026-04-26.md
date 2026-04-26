# Domera — карта модулей (2026-04-26, валидация 2026-04-26 v2)

> Полная инвентаризация всех существующих модулей системы в стиле 23-секционной таксономии.
> Каждый модуль: роль, что делает, где живёт в коде, статус, явные оговорки.
>
> **Валидация v2 (2026-04-26):** все 🟢-модули прогнаны через Definition of Ready
> (см. секцию ниже). Cleaning понижен до 🟡 — не подключён к unified Tasks
> inbox, что делает его частичным с точки зрения общей операционной логики.
> Locations остаётся 🟡 — INIT-005 P0 баг (`GET /v1/buildings/:id/locations`
> → 500) требует ручной перепроверки; код выглядит чистым по статике, но без
> live-теста после INIT-008 миграций статус не понижается до ready.
>
> Легенда статусов:
> - 🟢 **ready** — проходит все 7 пунктов Definition of Ready
> - 🟡 **partial** — backend есть, но проваливается на одном из пунктов DoR
> - 🔴 **missing** — нет реализации либо frontend = stub
>
> Источник истины: [docs/architecture/entity-ownership-ssot.md](entity-ownership-ssot.md).
> Sidebar nav: [apps/frontend/src/components/domera/app-shell.tsx](../../apps/frontend/src/components/domera/app-shell.tsx).

## Definition of Ready

Модуль считается 🟢 **ready** только если выполнены ВСЕ 7 пунктов:

1. **Backend endpoint работает** — реальный controller метод, возвращает валидный JSON
2. **Frontend использует реальные данные** — `apiRequest` / `useEffect` фетч, никаких хардкоженных моков в production UI
3. **Данные сохраняются в БД** — write-эндпоинт + Prisma `.create/.update` + UI вызывает его
4. **Данные не пересекаются между tenant** — RLS policy ИЛИ `where: { tenantId }` на каждом запросе
5. **Доступ ограничен RBAC** — `requireManager()` / `authorize()` / role-check ИЛИ explicit deny-by-default
6. **Есть ручной happy-path test** — путь «открыть страницу → создать → refresh → данные на месте» воспроизводится
7. **Нет mock/demo данных в production UI** — Storybook fixtures допустимы только в `**/__fixtures__/`

Если хоть один пункт failed → **🟡 partial** + явная заметка в "Заметки" модуля что именно не выполнено.

Дополнительные правила для специальных случаев:
- **#6 Tasks** остаётся 🟡 пока не агрегирует cleaning + reactive в один inbox.
- **#23 Admin UI** остаётся 🔴 пока не построен frontend для SSO/SCIM/MFA/webhooks.
- **#20 Cleaning** не считается полностью ready для общей операционной логики, пока не подключён к unified Tasks inbox (отдельная иерархия CleaningStaff != User — осознанная ограниченность).
- ~~**#11 Locations** остаётся 🟡 пока вручную не подтверждён (или починен) INIT-005 P0 баг с 500-ответом.~~ **Закрыто 2026-04-26** — bug не воспроизводится, contract test зелёный, статус 🟢.

---

## ПОРТФЕЛЬ (уровень всей компании / tenant)

### 1. Здания (Buildings)

**Роль:**
Главная сущность системы. Контейнер для всего остального.
Содержит: этажи, помещения, системы, людей, задачи. Tenant-isolated через RLS.

- **Backend:** [apps/api/src/modules/buildings/](../../apps/api/src/modules/buildings/) — `GET /v1/buildings`, `GET /v1/buildings/:idOrSlug`, `POST /v1/buildings`, `PATCH /v1/buildings/:slug`
- **Frontend:** [/[locale]/buildings/](../../apps/frontend/src/app/[locale]/buildings/page.tsx) (список) + [/[locale]/buildings/new/](../../apps/frontend/src/app/[locale]/buildings/new/page.tsx)
- **Статус:** 🟢 ready
- **Заметки:** Tenant-isolated через RLS (INIT-001 / INIT-006). Slug — единый ключ во всех URL.

### 2. Обзор (Portfolio Overview / Dashboard)

**Роль:**
Агрегированная аналитика по всем зданиям: активные задачи, аварии, PPM-статус, загрузка персонала.

- **Backend:** [apps/api/src/modules/role-dashboards/](../../apps/api/src/modules/role-dashboards/) — `GET /v1/role-dashboards/building-manager/:building`, `/technician`, `/fm-director`, `/tenant-representative`
- **Frontend:** [/[locale]/dashboard/](../../apps/frontend/src/app/[locale]/dashboard/page.tsx) → `ops-overview.tsx`
- **Статус:** 🟡 partial
- **Заметки:** Per-role дашборды есть; портфельная аналитика поверх (KPI стрипа на главной) — урезана.

### 3. Согласования (Approvals)

**Роль:**
Многоуровневые утверждения: заявки, закупки, работы, доступы. SoD + L1-L3 + Finance.

- **Backend:** [apps/api/src/modules/approvals/](../../apps/api/src/modules/approvals/) — `POST /v1/approvals/:id/approve`, `GET /v1/policies`, `POST /v1/policies/:id/supersede`, `POST /v1/delegations`, `GET /v1/bottlenecks`
- **Frontend:** [/[locale]/approvals/](../../apps/frontend/src/app/[locale]/approvals/page.tsx) → `approvals-list.tsx`
- **Статус:** 🟢 ready
- **Заметки:** SoD enforcement: PO issuer ≠ quote requester (см. reactive.service:296).

### 4. Диспетчерская (Dispatch / Triage)

**Роль:**
Центр управления заявками: распределение задач, контроль SLA, ручное вмешательство.

- **Backend:** [apps/api/src/modules/reactive/](../../apps/api/src/modules/reactive/) — `GET /v1/triage`, `POST /v1/work-orders/from-intake`, `POST /v1/incidents/:id/{ack,assign,resolve}`, `POST /v1/service-requests/:id/{assign,resolve}`
- **Frontend:** [/[locale]/triage/](../../apps/frontend/src/app/[locale]/triage/page.tsx) → `triage-page.tsx`
- **Статус:** 🟢 ready (после INIT-004 Phase 6 + INIT-007 Phase 4)
- **Заметки:** Manager-queue panel + auto-resolver chain primary→any→building→manager. Scope filters tasks.view_company / createdByScope.

### 5. Журнал аудита (Audit Log)

**Роль:**
Полная история действий: кто что сделал, изменения данных, безопасность. Immutable + tenant-isolated.

- **Backend:** [apps/api/src/modules/audit/](../../apps/api/src/modules/audit/) — `GET /v1/audit/search`, `GET /v1/audit/export.csv`
- **Frontend:** [/[locale]/audit/](../../apps/frontend/src/app/[locale]/audit/page.tsx) → `audit-log.tsx`
- **Статус:** 🟢 ready
- **Заметки:** SSOT-guard: только модуль `audit` пишет в `audit_entries`; все остальные через `audit.write()`.

### 6. Задачи (Tasks)

**Роль:**
Единый user-level inbox: PPM + cleaning + incidents.

- **Backend:** [apps/api/src/modules/tasks/](../../apps/api/src/modules/tasks/) — `GET /v1/tasks/:id`, `POST /v1/tasks/:id/{start,pause,resume,complete}`, `GET/POST /v1/tasks/:id/notes`
- **Frontend:** [/[locale]/tasks/](../../apps/frontend/src/app/[locale]/tasks/page.tsx) → `tasks-page.tsx`
- **Статус:** 🟡 partial
- **Заметки:** State machine на TaskInstance готов. Агрегация cleaning + reactive в один inbox — не сделана; пока показывает только PPM-задачи.

### 7. Комплаенс (Compliance)

**Роль:**
Контроль регламентов: проверки, стандарты, отчётность по обязательствам (страховка, инспекции, лицензии).

- **Backend:** [apps/api/src/modules/compliance/](../../apps/api/src/modules/compliance/) — `GET /v1/compliance/dashboard`; [obligations/](../../apps/api/src/modules/obligations/) — `GET /v1/obligations`, `POST /v1/obligations/apply-templates`; [compliance-profiles/](../../apps/api/src/modules/compliance-profiles/) — `GET/POST /v1/compliance-profiles`, `GET /v1/buildings/:id/compliance-profiles`
- **Frontend:** [/[locale]/compliance/](../../apps/frontend/src/app/[locale]/compliance/page.tsx) → `compliance-dashboard.tsx`
- **Статус:** 🟡 partial
- **Заметки:** SI 1525 / NFPA 25 + 84 obligations seeded. Frontend — dashboard skeleton, без drill-down по конкретному обязательству.

### 8. Документы (Documents — global)

**Роль:**
Хранилище файлов уровня портфеля: договоры, лицензии, шаблоны.

- **Backend:** [apps/api/src/modules/documents/](../../apps/api/src/modules/documents/) — `POST /v1/documents/upload`, `POST /v1/documents/:id/{legal-hold,virus-scan}`, `DELETE /v1/documents/:id`, `GET /v1/documents/:token`; [document-templates/](../../apps/api/src/modules/document-templates/) — CRUD
- **Frontend:** [/[locale]/documents/](../../apps/frontend/src/app/[locale]/documents/page.tsx) → `documents-page.tsx`
- **Статус:** 🟡 partial
- **Заметки:** Upload + retention + virus-scan working. Bulk-операции и template-rendering UI — отсутствуют.

---

## ТЕКУЩЕЕ ЗДАНИЕ

### ЗДАНИЕ

### 9. Обзор (Building Overview)

**Роль:**
Дашборд здания: текущие проблемы, статус систем, активные задачи.

- **Backend:** [apps/api/src/modules/building-core/](../../apps/api/src/modules/building-core/) — `GET /v1/buildings/:id/summary`
- **Frontend:** [/[locale]/buildings/[slug]/core/](../../apps/frontend/src/app/[locale]/buildings/[slug]/core/page.tsx)
- **Статус:** 🟢 ready
- **Заметки:** Summary aggregates floors + units + systems + occupants + contracts.

### 10. Атрибуты (Attributes / Settings)

**Роль:**
Метаданные здания: площадь, этажность, тип здания, настройки (timezone, currency, billing cycle).

- **Backend:** [buildings/](../../apps/api/src/modules/buildings/) (PATCH) + BuildingSettings table
- **Frontend:** [/[locale]/buildings/[slug]/settings/](../../apps/frontend/src/app/[locale]/buildings/[slug]/settings/page.tsx)
- **Статус:** 🟢 ready

### ПЛАНИРОВКА

### 11. Помещения (Spaces / Locations)

**Роль:**
Минимальная единица локации: офис, туалет, техкомната, lobby. Используется как target для QR-кодов.

- **Backend:** [building-core/](../../apps/api/src/modules/building-core/) — `GET /v1/buildings/:id/locations`, `POST /v1/buildings/:id/locations`
- **Frontend:** [/[locale]/buildings/[slug]/locations/](../../apps/frontend/src/app/[locale]/buildings/[slug]/locations/page.tsx) → `building-locations.tsx`
- **Статус:** 🟢 ready (повышено 2026-04-26 после live-теста + contract test)
- **DoR:** ✅ backend / ✅ real-data / ✅ DB / ✅ tenant / ✅ RBAC / ✅ **happy-path** / ✅ no-mock
- **Заметки:** **INIT-005 P0 баг закрыт.** Live-тест против `https://api.domerahub.com` 2026-04-26 показал HTTP 200 во всех 4-х сценариях: empty building → `[]`, после `POST /floors` + `POST /locations` → list содержит созданный item, второй GET возвращает тот же item (refresh-persistence), cross-tenant запрос НЕ возвращает данные первого тенанта и НЕ даёт 500. Скорее всего бага не стало после миграции 011 (RLS GUC rename) — оригинальный 500 был side-effect от silent default-deny RLS на 002/003 тенанту до INIT-008 Phase 1 fix.
- **Регрессия защищена** трёхслойно (апдейт #3 2026-04-26):
  1. [test/locations.contract.mjs](../../apps/api/test/locations.contract.mjs) — 6 contract assertions (200-empty / 200-with-data / persistence / cross-tenant strict 404 / forged-tenant strict 403 / **no-auth strict 401**).
  2. [.github/workflows/contract-smoke.yml](../../.github/workflows/contract-smoke.yml) — nightly cron (03:00 UTC) + manual trigger; запускает все contract-тесты против PROD автоматически. Push-trigger выключен намеренно (Railway redeploy lag → false negatives).
  3. CI grep guard в `prisma-validate` job на запрет `current_setting('app.tenant_id'` в любом SQL-файле — оригинальная причина 500 на 002/003 миграциях.
- **Что осталось:** edit / delete UI (после save можно только создать новую локацию через API). Это не P0 / не блокер MVP.

### 12. Этажи (Floors)

**Роль:**
Группировка помещений и логика назначения персонала. SSOT для FloorAssignment.

- **Backend:** [building-core/](../../apps/api/src/modules/building-core/) — `GET /v1/buildings/:id/floors`, `POST /v1/buildings/:id/floors`
- **Frontend:** [/[locale]/buildings/[slug]/floors/](../../apps/frontend/src/app/[locale]/buildings/[slug]/floors/page.tsx)
- **Статус:** 🟡 partial
- **Заметки:** CRUD + INIT-004 floor-assignment matrix. Нет floor-plan визуализации (drag-drop план этажа). Legacy `Floor` модель помечена DEPRECATED — каноничная `BuildingFloor`.

### 13. Офисы (Offices / Units)

**Роль:**
Коммерческие единицы (арендаторы сидят здесь). С BuildingUnitGroup для combined offices.

- **Backend:** [building-core/](../../apps/api/src/modules/building-core/) — `GET /v1/buildings/:id/units`, `POST /v1/buildings/:id/units`
- **Frontend:** [/[locale]/buildings/[slug]/units/](../../apps/frontend/src/app/[locale]/buildings/[slug]/units/page.tsx) → `units-grid-panel.tsx`
- **Статус:** 🟡 partial
- **Заметки:** Units grid + group merging. Lease lifecycle UI — отсутствует. Legacy `Unit` модель DEPRECATED.

### 14. Лифты (Elevators / Vertical Transport)

**Роль:**
Отдельный тип инженерной системы с вертикальной логикой (этажи обслуживания, грузоподъёмность, инспекции).

- **Backend:** [building-core/](../../apps/api/src/modules/building-core/) — `GET/POST /v1/buildings/:id/transport`
- **Frontend:** [/[locale]/buildings/[slug]/transport/](../../apps/frontend/src/app/[locale]/buildings/[slug]/transport/page.tsx)
- **Статус:** 🟡 partial
- **Заметки:** Модель + ElevatorProfile есть. Inspection calendar (SI 1525) — в obligations, но отдельного UI «лифт + его инспекции в одной карточке» нет.

### ОБОРУДОВАНИЕ И ОБСЛУЖИВАНИЕ

### 15. Активы (Assets)

**Роль:**
Все физические единицы: чиллеры, генераторы, насосы, fire panels. Связаны с PPM, документами, location.

- **Backend:** [apps/api/src/modules/assets/](../../apps/api/src/modules/assets/) — `GET /v1/assets` (portfolio), `GET /v1/buildings/:id/assets`, `POST /v1/buildings/:id/assets`, `PATCH/DELETE /v1/assets/:id`, `POST /v1/assets/:id/{custom-attributes,documents,media}`, `GET/POST /v1/assets/:id/ppm`, `GET/POST /v1/asset-types`
- **Frontend:** [/[locale]/assets/](../../apps/frontend/src/components/domera/pages/assets-page.tsx) (portfolio, **починен 2026-04-26 — больше не mock**) + [/[locale]/buildings/[slug]/assets/](../../apps/frontend/src/app/[locale]/buildings/[slug]/assets/page.tsx) + [`/assets/[id]`](../../apps/frontend/src/app/[locale]/buildings/[slug]/assets/[id]/page.tsx)
- **Статус:** 🟢 ready
- **Заметки:** **SSOT contract:** только `assets` модуль создаёт/редактирует Asset. PPM может прицепить расписание (`POST /assets/:id/ppm/attach`), но НЕ редактирует имя/манифекст актива. См. ssot-ownership.test.mjs.

### 16. Обслуживание (PPM)

**Роль:**
Планово-предупредительное обслуживание: чеклисты, расписание (RRULE), авто-задачи, calendar blackouts (Шаббат, Песах).

- **Backend:** [apps/api/src/modules/ppm/](../../apps/api/src/modules/ppm/) — `GET/POST /v1/buildings/:id/ppm/programs`, `GET /v1/buildings/:id/ppm/{executions,calendar}`, `POST /v1/ppm/executions/:id/{request-quote,mark-in-progress,record-completion,archive,cancel}`
- **Frontend:** [/[locale]/buildings/[slug]/ppm/](../../apps/frontend/src/app/[locale]/buildings/[slug]/ppm/page.tsx) + `ppm/setup/` + `ppm/wizard/`
- **Статус:** 🟢 ready
- **Заметки:** RRULE schedules + 84 obligation templates seeded. Wizard для bulk-apply программ.

### 17. Инженерные системы (Systems)

**Роль:**
Группировка активов: HVAC, Electrical, Fire, Water, BMS, Lift и т.д. SSOT для systemFamily на Asset.

- **Backend:** [building-core/](../../apps/api/src/modules/building-core/) — `GET/POST /v1/buildings/:id/systems`
- **Frontend:** [/[locale]/buildings/[slug]/systems/](../../apps/frontend/src/app/[locale]/buildings/[slug]/systems/page.tsx)
- **Статус:** 🟡 partial
- **Заметки:** CRUD + 25 system families seeded. Visual hierarchy (parent→child→component) — отсутствует.

### ЛЮДИ

### 18. Команда (Team)

**Роль:**
Все сотрудники: уборщики, техники, менеджеры, security. Floor-assignment matrix + today's availability.

- **Backend:** [apps/api/src/modules/iam/](../../apps/api/src/modules/iam/) (staff CRUD + role assign) + [assignment/](../../apps/api/src/modules/assignment/) (FloorAssignment + UserAvailability)
- **Frontend:** [/[locale]/buildings/[slug]/team/](../../apps/frontend/src/app/[locale]/buildings/[slug]/team/page.tsx) + [`/team/assignments/`](../../apps/frontend/src/app/[locale]/buildings/[slug]/team/assignments/page.tsx) (INIT-004)
- **Статус:** 🟢 ready (после INIT-004 Phase 4-5)
- **Заметки:** 25 ролей + 120 permissions. Persona switcher (INIT-007 Phase 8). Auto-assignment по этажу + роли + availability.

### 19. Арендаторы (Tenants / Occupants)

**Роль:**
Компании внутри здания: арендаторы офисов = источник service-requests. С TENANT_COMPANY_ADMIN ролью.

- **Backend:** [apps/api/src/modules/occupants/](../../apps/api/src/modules/occupants/) (BuildingOccupantCompany owner) + [tenant-companies/](../../apps/api/src/modules/tenant-companies/) (admin promotion)
- **Frontend:** [/[locale]/buildings/[slug]/tenants/](../../apps/frontend/src/app/[locale]/buildings/[slug]/tenants/page.tsx) + `/tenants/[id]/`
- **Статус:** 🟡 partial
- **Заметки:** Phase 4 INIT-007 — adminUserId + 3 роли (reception/tenant_company_admin/tenant_employee). Lease lifecycle UI неполна.

### ОПЕРАЦИИ

### 20. Уборка (Cleaning)

**Роль:**
Отдельный операционный модуль: задания, зоны ответственности, QR-заявки от жильцов, контракторы со своей иерархией.

- **Backend:** [apps/api/src/modules/cleaning/](../../apps/api/src/modules/cleaning/) — `GET/POST /v1/cleaning/requests`, `PATCH /v1/cleaning/requests/:id/{status,assign}`, zones, qr-points, staff CRUD; public `POST /v1/public/cleaning/qr/:code/request`
- **Frontend:** [/[locale]/cleaning/](../../apps/frontend/src/app/[locale]/cleaning/page.tsx) (portfolio) + [/[locale]/buildings/[slug]/cleaning/](../../apps/frontend/src/app/[locale]/buildings/[slug]/cleaning/page.tsx) (per-building) + cleaning QR form
- **Статус:** 🟡 partial (понижено 2026-04-26 валидацией v2)
- **DoR:** ✅ backend / ✅ real-data / ✅ DB / ✅ tenant / ✅ RBAC / ✅ happy-path / ✅ no-mock — ❌ **не подключён к unified Tasks inbox (#6)**
- **Заметки:** В изоляции модуль работает полноценно — assignment + lifecycle + QR + RBAC. Но в общей операционной логике cleaning-задачи живут в отдельной странице, а не в едином inbox техника, который уже частично собирает PPM. Параллельная иерархия `CleaningContractor → CleaningStaff` (boss/manager/supervisor/cleaner) — отдельная модель от User; auto-resolver INIT-004 целенаправленно не задействует её. Чтобы вернуть 🟢: либо построить bridge `CleaningStaff.userId` → User и слить задачи в `/v1/tasks/inbox`, либо добавить cleaning-источник в инбокс через явный union в backend.

### 21. Документы здания (Building Documents)

**Роль:**
Файлы, привязанные к конкретному зданию (страховка, BIM-планы, сертификаты).

- **Backend:** общий [documents/](../../apps/api/src/modules/documents/) с `buildingId` фильтром
- **Frontend:** [/[locale]/buildings/[slug]/documents/](../../apps/frontend/src/app/[locale]/buildings/[slug]/documents/page.tsx) → `building-documents.tsx`
- **Статус:** 🟡 partial
- **Заметки:** Дублирует #8 для building-scope. Document↔Asset link UI отсутствует — есть только в backend (document-links module).

---

## АДМИНИСТРИРОВАНИЕ

### 22. Панель разработчика (Developer Dashboard)

**Роль:**
Технический контроль: статус инициатив, флаги, milestones, тесты, мониторинг готовности модулей.

- **Backend:** [seed-runtime/](../../apps/api/src/modules/seed-runtime/) (data probes) + [metrics/](../../apps/api/src/modules/metrics/)
- **Frontend:** [/[locale]/admin/developer-dashboard/](../../apps/frontend/src/app/[locale]/admin/developer-dashboard/page.tsx)
- **Статус:** 🟢 ready
- **Заметки:** 8 INIT-инициатив с фазами + readiness map + flow + RU narratives. Источник истины — [`developer-dashboard-data.ts`](../../apps/frontend/src/lib/developer-dashboard-data.ts).

### 23. Админ (System Admin)

**Роль:**
Управление системой: роли, права, конфигурация, SSO/SCIM/MFA/webhooks.

- **Backend:** [sso/](../../apps/api/src/modules/sso/) + [mfa/](../../apps/api/src/modules/mfa/) + [scim/](../../apps/api/src/modules/scim/) + [webhooks/](../../apps/api/src/modules/webhooks/) + [organizations/](../../apps/api/src/modules/organizations/)
- **Frontend:** [/[locale]/admin/](../../apps/frontend/src/app/[locale]/admin/page.tsx) — **stub layout**
- **Статус:** 🔴 missing
- **Заметки:** Backend полностью готов (SCIM 2.0, TOTP MFA, SAML/OIDC, outbound webhooks). UI отсутствует — все настройки только через API.

---

## EXTRAS — модули не из 23-секционной таксономии

Эти модули существуют и работают, но не имеют отдельной строки в навигации. Часть — инфраструктура, часть — domain-расширения.

| Модуль | Роль | Статус |
|---|---|---|
| `auth` | Login, JWT, sessions, logout, MFA-step-up | 🟢 |
| `health` | `/v1/health` для Railway probes | 🟢 |
| `tenancy` | Middleware ALS-контекст по `X-Tenant-Id` | 🟢 |
| `onboarding` | Bootstrap первого workspace + здания | 🟢 |
| `iam` | Role assignment + ActorResolver (INIT-007) | 🟢 |
| `organizations` | Org CRUD (vendor / management_company / owner) | 🟢 |
| `projects` | Capital projects: stages + budget + change orders | 🟡 |
| `leases` | Lease versions + escalation + insurance | 🟡 |
| `reactive` | Incidents + service-requests + work-orders + quotes/POs | 🟡 |
| `inventory` | Spare parts + stock locations + movements | 🟡 |
| `rounds` | Inspection routes + waypoints | 🟡 |
| `devices` | IoT sensor registry | 🟡 |
| `qr-locations` | QR generation для локаций здания | 🟡 |
| `public-qr` | Public QR-submit endpoints (резиденты без логина) | 🟢 |
| `contractor-companies` | Universal ContractorCompany (INIT-007 P6) | 🟡 |
| `tenant-companies` | TENANT_COMPANY_ADMIN promotion (INIT-007 P4) | 🟢 |
| `vendor-invoices` | Контракторские инвойсы + matching | 🟡 |
| `calendar-blackouts` | Шаббат / Песах / праздники для PPM | 🟢 |
| `condition-triggers` | Reactive rules: «датчик X сработал → создать incident» | 🟡 |
| `emergency-overrides` | Emergency-override workflow | 🟡 |
| `privacy` | DSAR + ROPA + GDPR-compliance | 🟡 |
| `connectors` | Inbound webhooks → Incident creation | 🟡 |
| `imports` | Bulk import xlsx + PDF → массовое создание сущностей | 🟡 |
| `document-templates` | Шаблоны для генерации актов / писем | 🟡 |
| `document-links` | Связь Document ↔ Asset / Location | 🟡 |
| `role-dashboards` | Per-role homepages | 🟡 |
| `takeover` | Передача здания между operator-ами + sign-off | 🟡 |
| `metrics` | Prometheus /metrics + middleware | 🟢 |
| `webhooks` | Outbound webhook subscriptions + replay | 🟡 |
| `assignment` | INIT-004 FloorAssignment + UserAvailability | 🟢 |
| `seed-runtime` | Demo data probes для developer dashboard | 🟢 |

---

## ПРОВЕРКА МАТРИЦ И ЛОГИКИ

### Проверка SSOT (single source of truth)

✅ Каждая сущность имеет ровно одного владельца (создаёт/обновляет/удаляет). Защищено CI-тестом [test/ssot-ownership.test.mjs](../../apps/api/test/ssot-ownership.test.mjs).

| Сущность | Владелец | Кто читает |
|---|---|---|
| Asset (Чиллер, генератор...) | `assets` | ppm, reactive, assignment, role-dashboards |
| BuildingFloor | `building-core` | assignment, leases, reactive, public-qr, role-dashboards |
| BuildingSystem (HVAC...) | `building-core` | ppm, asset, condition-triggers |
| FloorAssignment | `assignment` (INIT-004) | reactive (через resolver), public-qr (через resolver) |
| Incident | `reactive` + `connectors` (webhooks) | triage, role-dashboards |
| AuditEntry | `audit` | все читают, никто не пишет напрямую |

### Известные дубли / consolidation TODO (см. [ssot doc](entity-ownership-ssot.md))

1. `BuildingOccupantCompany` создаётся и в `occupants`, и в `building-core` (legacy с INIT-001). Решение: убрать legacy create-path.
2. `BuildingContract` lifecycle — `building-core` создаёт, `leases` управляет статусами. Acceptable.
3. `Documents` модуль глобальный, но building-scope страница отдельная. Решение: единый компонент с `buildingId?`-prop.
4. `tasks` (#6 Tasks) показывает только PPM. Cleaning + reactive — каждый в своём модуле. Реальный unified inbox пока **не реализован**.

### Проверка ролевой матрицы (RBAC × ABAC)

Полная RBAC × ABAC матрица — [test/rbac-matrix.json](../../apps/api/test/rbac-matrix.json) + [rbac-matrix.test.mjs](../../apps/api/test/rbac-matrix.test.mjs). 17 строк × 6 scope-измерений (tenant / building / floor / contractorCompany / tenantCompany / createdByScope) для всех 25 ролей. CI-зелёный.

### Проверка матрицы flow (sidebar nav vs реальные модули)

[flow.tsx](../../apps/frontend/src/app/[locale]/admin/developer-dashboard/sections/flow.tsx) показывает 6 ключевых user-journey: register → first building, manager onboarding, resident QR scan, technician mobile day, cleaning QR, PPM lifecycle. Все 6 — `🟢 ready` после INIT-004.

---

## ИТОГ — после валидации v2 (2026-04-26, апдейт #2)

- **23 секции таксономии:** 16 🟢 + 6 🟡 + 1 🔴
- **Backend модулей всего:** 31
- **Frontend stubs в production UI:** 0 (последний — AssetsPage — починен 2026-04-26)
- **CI guards:** RLS isolation + RBAC matrix + SSOT ownership + locations contract — все зелёные

### Что изменилось при валидации v2

- **#20 Cleaning:** 🟢 → 🟡 (правило DoR: не подключён к unified Tasks inbox = частичный для общей операционной логики).
- ~~**#11 Locations:** оставлен 🟡 до live-теста INIT-005 P0 бага.~~ **Апдейт 2026-04-26:** live-тест против PROD прошёл — bug не воспроизводится. Добавлен [contract test](../../apps/api/test/locations.contract.mjs). **Locations → 🟢 ready.**
- **Definition of Ready** добавлен как явный контракт; ребята с дашборда теперь могут сами проверить статус.

### Апдейт #3 (2026-04-26) — auth-bypass на listing endpoints

**Pre-existing security finding** обнаружен при ужесточении cross-tenant assertion для locations contract:

`curl -H "X-Tenant-Id: <uuid>" https://api.domerahub.com/v1/buildings/<slug>/units` без Authorization header возвращал `200` с реальными данными тенанта. Воспроизведено: 152 unit-row из тенанта `b412c6af-...` без какой-либо аутентификации.

**Корневая причина.** [TenantMiddleware](../../apps/api/src/common/tenant.middleware.ts) до фикса проверял membership только когда BOTH token AND header присутствуют (`if (token && header && payload?.sub && !payload.superadmin)`). Когда токена нет — request проваливался дальше, контроллер просто фильтровал по tenantId из header и возвращал данные. Класс уязвимости: **Broken Authentication (OWASP A07).**

**Фикс.** TenantMiddleware теперь требует валидную JWT-сессию для **всех non-bypass paths**. Если `payload?.sub` отсутствует → `UnauthorizedException(401)` до того как контроллер запустится. BYPASS_PATHS (auth/login, register, refresh, me, health, public-qr, metrics, sso/callback) сохраняют свой no-auth контракт.

**Защита от регрессий.** В contract-тесте теперь явная assertion: `no-auth + valid X-Tenant-Id → strict 401`. Если кто-то ослабит middleware — nightly CI поймает.

### Приоритеты — что делать дальше

~~**P0 — блокеры для production-trust:**~~ **Список пуст.** INIT-005 P0 (Locations 500) закрыт 2026-04-26.

**P1 — главный operational gap (теперь это #1 приоритет):**

1. **#6 Unified Tasks Inbox** (INIT-009) — единый user-inbox PPM + Cleaning + Reactive. Сейчас задачи в трёх местах, технику нужно открывать три страницы. Решение: добавить `/v1/tasks/inbox` агрегатор (union трёх источников по `assignedUserId`) + переписать [tasks-page.tsx](../../apps/frontend/src/components/domera/pages/tasks-page.tsx). Оценка: 1-2 дня. **Это следующий шаг разработки.**

**P2 — отложено:**

2. **#23 Admin UI** — backend готов (SSO/SCIM/MFA/webhooks), нужен sprint UI. Не блокирует операции; можно через API.
3. **#12 Floors** — floor-plan SVG/canvas (visualisation only)
4. **#14 Elevators** — «лифт + его инспекции» single-card view
5. **#17 Systems** — parent→child иерархия MEP
6. **#21 Building Documents** — UI для Document ↔ Asset link
7. **#11 Locations** — edit/delete UI поверх существующего create.

---

## Manual Happy-Path Test (DoR criterion #6)

Воспроизводимый сквозной тест после любых migrations / refactors. Все шаги выполняются от свежего рабочего пространства.

### Подготовка

```bash
# Запустить backend + frontend локально (или указать на test environment)
pnpm --filter @domera/api dev
pnpm --filter @domera/frontend dev
# Открыть http://localhost:3000/ru/login
```

### Тестовый сценарий

| # | Шаг | Где | Ожидание |
|---|---|---|---|
| 1 | Зарегистрировать нового пользователя | `/ru/register` | Редирект на /setup |
| 2 | Создать здание | `/ru/setup` (bootstrap form) | Редирект на /dashboard, в sidebar появляется building |
| 3 | Создать этажи (3 этажа) | `/ru/buildings/<slug>/floors` → "Add floor" × 3 | После refresh — 3 этажа на месте |
| 4 | Создать помещения (2 на этаж) | `/ru/buildings/<slug>/locations` → "Add location" | **⚠️ INIT-005 чек:** GET locations НЕ возвращает 500 |
| 5 | Создать актив (Чиллер) | `/ru/buildings/<slug>/assets` → "New asset" | Актив появляется в `/ru/assets` (portfolio) после refresh |
| 6 | Создать PPM программу | `/ru/buildings/<slug>/ppm/wizard` → выбрать "HVAC quarterly" | Программа в списке + автоматически сгенерированные TaskInstance |
| 7 | Создать cleaning request | `/ru/buildings/<slug>/cleaning` → "Create request" | Request в списке со статусом `new` |
| 8 | Создать reactive request (incident) | `/ru/buildings/<slug>/incidents` или через QR | Request попадает в `/ru/triage` |
| 9 | Открыть Tasks inbox | `/ru/tasks` | **❌ известный gap:** показывает только PPM-задачи, cleaning + reactive отсутствуют |
| 10 | Проверить ролевую матрицу: manager / technician / cleaner | Создать через `/ru/buildings/<slug>/team` × 3 ролей | Каждый видит свой набор страниц в sidebar (persona switcher INIT-007 P8) |

### Acceptance

- Шаги 1-8 + 10 проходят без ошибок 500
- После refresh каждой страницы данные на месте
- Cross-tenant: создать второго пользователя в другом workspace, убедиться что он НЕ видит данные первого
- Шаг 9 ожидаемо падает на cleaning + reactive — это и есть P1 gap

### Failed-step → блокер

Если падает любой из шагов 1-8 или 10 — это P0, статус соответствующего модуля **должен быть понижен до 🟡 в этом документе** до починки.
