# Domera Engineering SSOT

Domera is a SaaS platform: "Operating System for Buildings".

This file is the top-level Source of Truth (SSOT) index.
Detailed engineering SSOT is maintained in:

- `docs/ssot/DOMERA_DEVELOPMENT_SSOT.md`

## Non-Negotiable Architecture Truths
1. `tenant != building`
2. Domain backbone is:
   `workspace -> organizations -> buildings -> mandates -> roles -> assets -> obligations -> plans -> tasks -> documents -> approvals -> audit`
3. Product core is not generic tasks-first; it is compliance, PPM, evidence, approvals, and governance.
4. Every tenant-owned entity must have `tenant_id`.
5. Every building-owned entity must have `building_id`.
6. Sensitive operations must produce audit entries.
7. Recurrence and escalations run via workers/queues, never in HTTP request path.
8. REST-first + OpenAPI is default contract.
9. GraphQL is read-side BFF only.
10. Domain changes must be incremental, verifiable, and reversible.

## Delivery Priority
1. Stability
2. Security
3. MVP speed
4. Scalability
5. Code clarity

## Bounded Contexts
- `core`
- `tenancy`
- `organizations`
- `mandates`
- `iam`
- `buildings`
- `units`
- `assets`
- `obligations`
- `ppm`
- `tasks`
- `documents`
- `approvals`
- `audit`
- `takeover_import`
- `notifications`
- `analytics`
- `admin`
- `billing`
- `marketplace`

## Mandatory Task Response Format
- Stage
- Goal
- What we do now
- What we do not touch
- Cursor task
- Verification

## Control Commands
- `/plan` -> break down task into safe steps
- `/task` -> provide one concrete task
- `/review` -> review Cursor result
- `/fix` -> propose minimal correct fix
- `/arch` -> assess architecture risks and best path
- `/schema` -> propose DB schema and migrations
- `/api` -> design endpoint, DTO, validation, errors
- `/test` -> provide test plan and acceptance criteria
- `/ship` -> pre-merge/deploy checklist
- `/adr` -> concise architecture decision record
