# Module RFC — `privacy`

## 1. Why this module exists

Owns GDPR / DSAR (Data Subject Access Request) and RoPA (Record of Processing Activities) operations: erasure, export, suspension. These are sensitive cross-module operations — a DSAR-erase touches `users`, `team_members`, `audit_entries` (anonymise), `documents` (purge), `notification_deliveries` (purge). The privacy module orchestrates; canonical writes happen through each owner module's privileged service method (`auth.anonymizeUser`, etc.) so SSOT is preserved.

## 2. Scope and non-scope

### In scope
- DSAR intake: `POST /v1/privacy/dsar` with `subjectUserId + requestType (export | erasure | rectification)`.
- Erasure orchestration: calls `auth.anonymizeUser` + `documents.purgeForUser` + `notifications.purgeForUser` in a strict order; emits `privacy.dsar.fulfilled` event.
- Export orchestration: gathers all rows referencing the subject across owned-module read paths, returns a signed S3 link.
- RoPA generator: weekly job that scans all tenant-scoped tables and emits a CSV summary of which tenant has what kind of personal data.
- Legal-hold flag — when set, erasure/anonymise operations on the affected entity are blocked until lifted.

### Out of scope
- Per-module data deletion code — orchestration only.
- Cookie banners / consent collection on the marketing site.
- Encryption-at-rest configuration — infrastructure.

## 3. Owned entities

| Model | Table |
|---|---|
| `DsarRequest` | `dsar_requests` |
| `LegalHold` | `legal_holds` |
| `RopaSnapshot` | `ropa_snapshots` |

## 4. Tenant scope

Tenant-scoped via RLS. DSAR for cross-workspace users (rare — same email in multiple tenants) requires per-workspace DSAR requests.

## 5. Events

`privacy.dsar.opened`, `privacy.dsar.fulfilled`, `privacy.dsar.rejected`, `privacy.legal_hold.applied`, `privacy.legal_hold.lifted`. All audit-stamped (sensitive=true).

## 6. Permissions

- `privacy.dsar.handle` — admin / privacy_officer.
- `privacy.legal_hold.apply` — workspace_owner.
- `privacy.ropa.read` — auditor.

## 7. Surface

- `POST /v1/privacy/dsar` — open request.
- `GET /v1/privacy/dsar/:id` — status.
- `POST /v1/privacy/dsar/:id/fulfill` — finalize (privacy_officer only).
- `POST /v1/privacy/legal-hold` — apply.
- `DELETE /v1/privacy/legal-hold/:id` — lift.
- `GET /v1/privacy/ropa/latest` — current snapshot.

## 8. Hard rules

1. **Erasure is irreversible.** UI requires double-confirmation. Server requires `confirmation: 'PERMANENTLY-ERASE-<userId>'` body field exact match.
2. **Legal-hold blocks erasure.** Privacy module checks every legal_hold row touching the subject before invoking the orchestration.
3. **All cross-module writes go through the owner module's service method.** No direct prisma calls from privacy.
4. Every action audit-stamped with `sensitive=true`.
