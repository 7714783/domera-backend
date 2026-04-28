// Scope-based access for the cleaning module. Each caller resolves to a scope
// that bounds what they can see and do. Non-flat RBAC — the role alone is
// not enough; the building/contractor/zone set matters.

import { ForbiddenException } from '@nestjs/common';

export type CleaningActor =
  | { kind: 'building_manager'; userId: string; tenantId: string; buildingIds: string[] }
  | { kind: 'operations_manager'; userId: string; tenantId: string; buildingIds: string[] }
  | {
      kind: 'cleaning_boss';
      userId: string;
      tenantId: string;
      contractorIds: string[];
      buildingId: string;
    }
  | {
      kind: 'cleaning_manager';
      userId: string;
      tenantId: string;
      contractorIds: string[];
      buildingId: string;
    }
  | {
      kind: 'cleaning_supervisor';
      userId: string;
      tenantId: string;
      staffId: string;
      contractorId: string;
      zoneIds: string[];
    }
  | { kind: 'cleaner'; userId: string; tenantId: string; staffId: string; contractorId: string }
  | { kind: 'platform_admin'; userId: string; tenantId: string };

export interface RequestFilter {
  tenantId: string;
  buildingId?: { in: string[] } | string;
  contractorId?: { in: string[] } | string;
  zoneId?: { in: string[] };
  assignedStaffId?: string;
  OR?: any[];
}

export function filterForActor(actor: CleaningActor): RequestFilter {
  const base: RequestFilter = { tenantId: actor.tenantId };
  switch (actor.kind) {
    case 'platform_admin':
      return base;
    case 'building_manager':
    case 'operations_manager':
      return { ...base, buildingId: { in: actor.buildingIds } };
    case 'cleaning_boss':
    case 'cleaning_manager':
      return { ...base, buildingId: actor.buildingId, contractorId: { in: actor.contractorIds } };
    case 'cleaning_supervisor':
      return {
        ...base,
        contractorId: actor.contractorId,
        OR: [{ zoneId: { in: actor.zoneIds } }, { assignedStaffId: actor.staffId }],
      };
    case 'cleaner':
      return { ...base, contractorId: actor.contractorId, assignedStaffId: actor.staffId };
  }
}

export function canAssign(actor: CleaningActor): boolean {
  return [
    'platform_admin',
    'building_manager',
    'operations_manager',
    'cleaning_boss',
    'cleaning_manager',
    'cleaning_supervisor',
    'cleaning_dispatcher' as any,
  ].includes(actor.kind);
}

export function canChangeStatus(actor: CleaningActor, from: string, to: string): boolean {
  const allowedTransitions: Record<string, string[]> = {
    new: ['assigned', 'cancelled'],
    assigned: ['in_progress', 'cancelled', 'assigned'],
    in_progress: ['done', 'assigned'],
    done: [], // terminal in MVP
    rejected: [],
    cancelled: [],
  };
  if (!(allowedTransitions[from] || []).includes(to)) return false;

  // Role constraints
  if (actor.kind === 'cleaner') {
    return (
      (from === 'assigned' && to === 'in_progress') || (from === 'in_progress' && to === 'done')
    );
  }
  if (actor.kind === 'cleaning_supervisor') {
    return ['assigned', 'in_progress', 'done', 'cancelled'].includes(to);
  }
  return true; // managers + above
}

export function assertInScope(
  actor: CleaningActor,
  payload: {
    buildingId?: string;
    contractorId?: string | null;
    zoneId?: string;
    assignedStaffId?: string | null;
  },
) {
  switch (actor.kind) {
    case 'platform_admin':
      return;
    case 'building_manager':
    case 'operations_manager':
      if (payload.buildingId && !actor.buildingIds.includes(payload.buildingId)) {
        throw new ForbiddenException('building out of scope');
      }
      return;
    case 'cleaning_boss':
    case 'cleaning_manager':
      if (payload.buildingId && payload.buildingId !== actor.buildingId)
        throw new ForbiddenException('building out of scope');
      if (payload.contractorId && !actor.contractorIds.includes(payload.contractorId))
        throw new ForbiddenException('contractor out of scope');
      return;
    case 'cleaning_supervisor':
      if (payload.contractorId && payload.contractorId !== actor.contractorId)
        throw new ForbiddenException('contractor out of scope');
      if (payload.zoneId && !actor.zoneIds.includes(payload.zoneId))
        throw new ForbiddenException('zone out of scope');
      return;
    case 'cleaner':
      if (payload.contractorId && payload.contractorId !== actor.contractorId)
        throw new ForbiddenException('contractor out of scope');
      if (payload.assignedStaffId && payload.assignedStaffId !== actor.staffId)
        throw new ForbiddenException('task not assigned to you');
      return;
  }
}
