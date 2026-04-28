# Module RFC — `auth`

## 1. Why this module exists

Owns the authentication contract: User account lifecycle, password hashing, JWT issuance + verification, the Session table (revocation + lookup-by-tokenHash), workspace switching, super-admin view-as.

Every other module trusts the `Authorization: Bearer …` header and the `X-Tenant-Id` (resolved per-request by `TenantMiddleware` from the user's active membership). When a token is missing or revoked, this module produces the 401 — domain modules never reach their handlers without a session.

## 2. Scope and non-scope

### In scope
- `User` table CRUD (register, password change, anonymise via privacy/DSAR).
- `Session` table — token issuance, revocation, last-seen tracking.
- JWT signing with `JWT_SECRET` (HS256), payload shape `{ sub, username, superadmin, jti }`.
- Login (username OR email + password), logout, logout-all.
- Workspace switch (`POST /v1/auth/switch-workspace`) — JWT rotation + old-token revoke.
- `me` endpoint that returns memberships + buildingRoles + organizationMemberships + effectivePermissions + roleCatalogue (when admin view-as is allowed).

### Out of scope
- MFA / TOTP — owned by `mfa` module.
- SSO / OIDC — owned by `sso` module.
- SCIM provisioning — owned by `scim` module.
- Authorisation (permissions, ABAC scope) — owned by `iam` + `role-assignments`.

## 3. Owned entities

| Model | Table | Notes |
|---|---|---|
| `User` | `users` | global; `Membership` rows scope to tenants |
| `Session` | `sessions` | tokenHash unique; revocation via revokedAt |

## 4. Tenant scope

Users + sessions are global (a user can belong to N workspaces). `Membership` is tenant-scoped (other module). RLS does not apply to `users` / `sessions`.

## 5. Events emitted

`auth.user.registered`, `auth.session.issued`, `auth.session.revoked`, `auth.workspace.switched` — emitted via `audit.write`, not via outbox (no cross-module subscribers today).

## 6. Permissions

- `user.manage` — register / suspend / anonymise.
- `user.invite` — invite + new-membership.
- `auth.session.read_all` — admin troubleshooting.

## 7. Surface

- `POST /v1/auth/register`
- `POST /v1/auth/login`
- `GET /v1/auth/me`
- `GET /v1/auth/sessions`
- `POST /v1/auth/logout`
- `POST /v1/auth/logout-all`
- `POST /v1/auth/switch-workspace`

Privileged service methods exposed to other modules:
- `verifySession(token)` — used by every controller that takes `Authorization`.
- `issueSession(userId, meta)` — used by `sso` after OIDC callback.
- `anonymizeUser(userId, reason)` — used by `privacy` for DSAR-erasure.
- `suspendUser(userId)` — admin op via `iam`.
