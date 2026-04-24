// INIT-007 Phase 3 — authorization primitives.
//
// Structure mirrors NIST SP 800-162 (ABAC): Actor + ResourceRef + Operation
// (the permission string) + optional environmental conditions (MFA level).
// Scope semantics — per research brief 2026-04-24:
//
//   undefined / empty array = unrestricted within parent scope
//   populated array         = restricted to listed ids
//   null field              = dimension not applicable (skip)
//
// Every guard runs server-side in a trusted service layer (OWASP ASVS V1.4.4).

export type Scope = {
  tenantId: string;
  buildingIds?: string[];
  floorIds?: string[];
  zoneIds?: string[];
  systemIds?: string[];
  contractorCompanyId?: string | null;
  tenantCompanyId?: string | null;
  teamId?: string | null;
  /** When true, task-oriented listings additionally filter to
   *  createdByUserId = actor.userId (TENANT_EMPLOYEE self-service pattern). */
  createdByScope?: boolean;
};

export type Actor = {
  userId: string;
  activeRole: string;
  permissions: Set<string>;
  scope: Scope;
  /** Bumps on every role/permission mutation so stale JWTs can be rejected. */
  authzVersion: number;
  mfaLevel?: 'none' | 'password' | 'mfa';
  isSuperAdmin?: boolean;
};

export type ResourceRef = {
  tenantId: string;
  buildingId?: string | null;
  floorId?: string | null;
  zoneId?: string | null;
  systemId?: string | null;
  contractorCompanyId?: string | null;
  tenantCompanyId?: string | null;
  teamId?: string | null;
  assignedUserId?: string | null;
  createdByUserId?: string | null;
};

export type AuthorizeOptions = {
  /** Step-up MFA required for this operation (OWASP ASVS V1.4.5). */
  requireMfa?: boolean;
};

/** Thrown by the guard functions. Controllers should let this bubble —
 *  Nest's HttpException filter turns it into a 403. The reason code is a
 *  short machine-readable string so audit/log queries can bucket them. */
export class AuthorizationError extends Error {
  readonly statusCode = 403;
  constructor(public readonly reasonCode: string) {
    super(reasonCode);
    this.name = 'AuthorizationError';
  }
}
