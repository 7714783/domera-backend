// INIT-007 Phase 3 — policy engine.
//
// Three entry points:
//   requirePermission(actor, permission)   — "does this persona do this kind of action at all?"
//   requireScope(actor, resource)          — "can they do it on THIS object?"
//   authorize(actor, permission, resource) — combined + optional step-up
//
// Every scope check is explicit: a dimension (`buildingIds`, `floorIds`, …)
// that is undefined or empty on the actor is treated as "unrestricted
// within the parent scope". A dimension that is null on the resource is
// "not applicable — skip". A dimension that is a populated list on the
// actor and a concrete id on the resource must match.
//
// This file has ZERO runtime dependencies so it can be unit-tested with
// plain ts + node (no Nest, no Prisma). Keep it pure.

import { Actor, AuthorizationError, AuthorizeOptions, ResourceRef, Scope } from './types';

function inList(list: string[] | undefined, value: string | null | undefined): boolean {
  if (value == null) return true; // resource dimension absent
  if (list === undefined) return true; // actor unrestricted within parent scope
  if (list.length === 0) return true; // empty array also == unrestricted (seed default)
  return list.includes(value);
}

export function requirePermission(actor: Actor, permission: string): void {
  if (actor.isSuperAdmin) return; // platform break-glass bypass, audited elsewhere
  if (!actor.permissions.has(permission)) {
    throw new AuthorizationError('MISSING_PERMISSION');
  }
}

export function requireScope(actor: Actor, resource: ResourceRef): void {
  if (actor.isSuperAdmin) return;

  if (actor.scope.tenantId !== resource.tenantId) {
    throw new AuthorizationError('CROSS_TENANT_ACCESS');
  }
  if (!inList(actor.scope.buildingIds, resource.buildingId ?? null)) {
    throw new AuthorizationError('BUILDING_SCOPE_VIOLATION');
  }
  if (!inList(actor.scope.floorIds, resource.floorId ?? null)) {
    throw new AuthorizationError('FLOOR_SCOPE_VIOLATION');
  }
  if (!inList(actor.scope.zoneIds, resource.zoneId ?? null)) {
    throw new AuthorizationError('ZONE_SCOPE_VIOLATION');
  }
  if (!inList(actor.scope.systemIds, resource.systemId ?? null)) {
    throw new AuthorizationError('SYSTEM_SCOPE_VIOLATION');
  }
  if (
    actor.scope.contractorCompanyId != null &&
    actor.scope.contractorCompanyId !== resource.contractorCompanyId
  ) {
    throw new AuthorizationError('CONTRACTOR_SCOPE_VIOLATION');
  }
  if (
    actor.scope.tenantCompanyId != null &&
    actor.scope.tenantCompanyId !== resource.tenantCompanyId
  ) {
    throw new AuthorizationError('TENANT_COMPANY_SCOPE_VIOLATION');
  }
  if (actor.scope.teamId != null && actor.scope.teamId !== resource.teamId) {
    throw new AuthorizationError('TEAM_SCOPE_VIOLATION');
  }
  if (
    actor.scope.createdByScope === true &&
    resource.createdByUserId != null &&
    resource.createdByUserId !== actor.userId
  ) {
    throw new AuthorizationError('CREATED_BY_SCOPE_VIOLATION');
  }
}

export function authorize(
  actor: Actor,
  permission: string,
  resource: ResourceRef,
  opts?: AuthorizeOptions,
): void {
  requirePermission(actor, permission);
  requireScope(actor, resource);
  if (opts?.requireMfa && actor.mfaLevel !== 'mfa') {
    throw new AuthorizationError('STEP_UP_REQUIRED');
  }
}

/** Build a Prisma-style where-clause snippet that narrows a collection
 *  query to the actor's scope. Returns a plain object that can be spread
 *  into `where`. Callers still need to include their own filters. */
export function scopeWhere(scope: Scope): Record<string, unknown> {
  const where: Record<string, unknown> = { tenantId: scope.tenantId };
  if (scope.buildingIds && scope.buildingIds.length > 0) {
    where.buildingId = { in: scope.buildingIds };
  }
  if (scope.floorIds && scope.floorIds.length > 0) {
    where.floorId = { in: scope.floorIds };
  }
  if (scope.zoneIds && scope.zoneIds.length > 0) {
    where.zoneId = { in: scope.zoneIds };
  }
  if (scope.systemIds && scope.systemIds.length > 0) {
    where.systemId = { in: scope.systemIds };
  }
  if (scope.contractorCompanyId) {
    where.contractorCompanyId = scope.contractorCompanyId;
  }
  if (scope.tenantCompanyId) {
    where.tenantCompanyId = scope.tenantCompanyId;
  }
  if (scope.teamId) {
    where.teamId = scope.teamId;
  }
  return where;
}

export { Actor, AuthorizationError, AuthorizeOptions, ResourceRef, Scope };
