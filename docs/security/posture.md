# Domera security posture

## Identity & access

- Password auth: bcrypt cost 12, JWT HS256, 7-day sessions in `sessions` table
  with server-side revoke on logout or password change.
- TOTP MFA (RFC 6238, SHA-1/6-digit/30s) mandatory for `workspace_owner`,
  `workspace_admin`, `finance_controller`, `approver`, `owner_representative`.
  Non-privileged roles MAY enrol voluntarily. Enrolment flow:
  `POST /v1/mfa/enroll/start` (returns secret + `otpauth://` URL for QR) →
  `POST /v1/mfa/enroll/verify`.
- Role model: 18 roles × 83 permissions in reference tables +
  `BuildingRoleAssignment` for building-scoped RBAC. Separation of Duties
  enforced on approvals, PPM review, change orders, acceptance pack signoff.

## Tenant isolation

- PostgreSQL RLS on all 81 tenant-scoped tables; `FORCE ROW LEVEL SECURITY`
  enabled so even the table owner is subject.
- Runtime role `domera_app` is `NOBYPASSRLS`. Migrator role `domera_migrator`
  owns tables and has `BYPASSRLS` for schema changes and seeds only.
- AsyncLocalStorage carries tenant id; Prisma `$extends` auto-wraps every
  query in a transaction that calls
  `set_config('app.current_tenant_id', <uuid>, true)` before the query,
  scoping the GUC to the transaction so it never leaks across requests.
- Escalation path documented in [tenant-isolation-policy.md](../architecture/tenant-isolation-policy.md).

## Document controls

- SHA-256 on upload + MIME allowlist enforced server-side against a sniffed
  prefix.
- Virus scan status (`pending | clean | infected | unscanned`) tracked on
  `documents`. Hard delete blocked if `legalHold=true` or
  `retentionUntil > now()`.
- Storage key is tenant- and building-scoped:
  `t/<tenant>/b/<building>/d/<sha256>`. Local-disk adapter ships today;
  S3 adapter slot is ready (`ObjectStorage` interface).

## Secrets

- Runtime secrets (DB URL, JWT signing key) are read from the process
  environment only. No secret is committed to the repo; `.env.example`
  contains shape-only placeholders.
- HMAC shared secrets for outbound webhook subscriptions + inbound webhook
  sources are generated server-side (`crypto.randomBytes(32)`) and returned
  exactly once at creation time.
- Production deployment MUST mount secrets from HashiCorp Vault / AWS Secrets
  Manager / Azure Key Vault — the app has no local cache, which means every
  process restart reads fresh values.

## Audit

- Every sensitive operation writes an `AuditEntry` with actor, role, action,
  entity type, entity id, building, IP, `sensitive=true`.
- Tamper-resistance: `audit_entries` is append-only at the application level
  (no UPDATE / DELETE endpoints) and behind RLS at the DB level.
- Export via `GET /v1/audit/export.csv` with the same filters as the search
  endpoint (`q`, actor, action, entityType, sensitiveOnly, from, to).
- Legal-hold flag on documents is itself an audited boolean set through
  `POST /v1/documents/:id/legal-hold`.

## Network & transport

- HTTPS enforced at the edge (deployment-specific).
- CORS open-origin with credentials; the `x-tenant-id` header is ACL'd server
  side, not at the CORS layer.
- CSRF: double-submit cookie on state-changing web requests (frontend
  responsibility; API is stateless modulo sessions).

## Pentest / external review

- **Target cadence**: annual external pentest + quarterly internal security
  review.
- **Scope**: authn/authz, tenant isolation (RLS bypass attempts), document
  controls (upload MIME spoofing, storage key traversal), HMAC signature
  verification on inbound webhooks, SoD bypass, DSAR edge cases.
- Findings ticketed in Linear project `SEC`, linked from this doc.

## Compliance mapping

| Standard | Coverage |
|---|---|
| OWASP Top 10 2021 | A01, A02, A03, A05, A07, A08 mitigated; A04 (design) enforced by SoD rules; A09 (logging) met via AuditEntry + Prometheus + structured logs |
| GDPR | Arts 5, 6, 12-22 covered; see [gdpr-inventory.md](../compliance/gdpr-inventory.md) |
| ISO 27001 | Controls A.5, A.8, A.9, A.12, A.16, A.18 partially covered |
| NIS2 | Incident reporting and telemetry event logs ready for regulator export |
