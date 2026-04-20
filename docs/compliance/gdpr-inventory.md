# GDPR / privacy inventory

Living record. The authoritative state is stored in the `personal_data_categories`
table and accessible via `GET /v1/privacy/categories` — this doc mirrors the
seed set for reference and is the input to the Records of Processing (RoPA)
export at `GET /v1/privacy/ropa`.

## Personal data categories (default tenant seed)

| key | name | Lawful basis | Retention | Storage |
|---|---|---|---|---|
| `user_identity` | User identity (email, display name) | Contract | until account deletion | `users`, `sessions` |
| `tenant_rep_contact` | Tenant representative contact | Contract | 7 years after lease end | `tenant_representatives`, `building_occupant_companies` |
| `lease_contract` | Lease contract data | Legal obligation | 7 years (tax/accounting) | `building_contracts` |
| `service_request_submitter` | Service request submitter contact | Legitimate interest | 2 years | `service_requests` |
| `incident_reporter` | Incident reporter identity | Legal obligation | 7 years (safety records) | `incidents` |
| `audit_log_actor` | Audit log actor identifiers | Legal obligation | indefinite | `audit_entries` |
| `photo_evidence` | Photos attached to service requests / completions | Legitimate interest | 5 years | `documents`, `service_requests` |

Seed via `POST /v1/privacy/categories/seed-built-ins` (idempotent upsert by `key`).
Customise per tenant via `POST /v1/privacy/categories`.

## DSAR channel

The Data Subject Access Request process:

1. Subject emails `privacy@<tenant-domain>` or submits via `POST /v1/privacy/dsar`
   with `{ subjectEmail, kind: access|delete|restrict|portability }`.
2. DPO verifies identity (out of band).
3. DPO calls `POST /v1/privacy/dsar/:id/process`:
   - **access/portability** → returns identity, memberships, org memberships,
     building roles, tenant-rep links, session metadata.
   - **delete** → anonymises `users` row (`deleted-<shortid>@redacted.local`,
     clears `passwordHash`, `displayName → "Deleted User"`, `status=deleted`),
     revokes all active sessions.
   - **restrict** → sets `users.status=suspended` (read-only account; the user
     cannot log in but their data remains for legal-hold / tax purposes).
4. Every DSAR is written to `audit_entries` (actor, kind, entity `dsar_request`).

## Retention enforcement

- `Document.retentionUntil` — enforced by the delete endpoint which refuses
  if `retentionUntil > now()` or `legalHold=true`.
- Other categories: automated purge worker runs nightly (TODO: schedule via
  BullMQ; see `docs/roadmap/P19.md`).

## Subprocessor registry

(Tenant-customised; default is empty.)

| Processor | Role | Data categories | DPA version |
|---|---|---|---|
| _(none in default deployment)_ | | | |

Add entries via the RoPA tooling when third-party processors are onboarded.
