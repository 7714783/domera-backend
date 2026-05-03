// INIT-004 Phase 2 — Auto-assignment resolver.
//
// Resolves a request (cleaning / incident / service-request) to a single user
// by walking a deterministic chain:
//
//   1. primary FloorAssignment (floorId, roleKey) — the named owner
//   2. any FloorAssignment   (floorId, roleKey)   — anyone tagged to this floor
//   3. any BuildingRoleAssignment (buildingId, roleKey) — building-wide backup
//   4. null → caller routes to the manager queue
//
// Availability is opt-out: if user_availability has no row for (userId, date),
// the user is assumed available. A row with status in {off, leave, sick}
// removes them from the candidate pool for that date.
//
// Pure-ish: takes a Prisma surface (ResolverPrisma) so it's trivial to mock
// in unit tests. RLS still applies — caller must invoke through PrismaService.

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AssignmentInput,
  AssignmentOutput,
  AssignmentSource,
  ResolverPrisma,
} from './assignment.types';

const UNAVAILABLE_STATUSES = new Set(['off', 'leave', 'sick', 'absent', 'unavailable']);

function startOfDayUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export async function resolveAssignment(
  prisma: ResolverPrisma,
  input: AssignmentInput,
): Promise<AssignmentOutput> {
  const on = startOfDayUtc(input.on ?? new Date());

  // Step 1 + 2 — only relevant when a floor is known.
  if (input.floorId) {
    const floorRows = await prisma.floorAssignment.findMany({
      where: {
        tenantId: input.tenantId,
        floorId: input.floorId,
        roleKey: input.roleKey,
      },
      select: { userId: true, primary: true },
    });

    if (floorRows.length > 0) {
      const userIds = floorRows.map((r) => r.userId);
      const unavailable = await loadUnavailable(prisma, input.tenantId, userIds, on);

      const primaries = floorRows.filter((r) => r.primary && !unavailable.has(r.userId));
      if (primaries.length > 0) {
        return mk(primaries[0].userId, 'floor.primary', 'primary floor assignment');
      }

      const anyOnFloor = floorRows.find((r) => !unavailable.has(r.userId));
      if (anyOnFloor) {
        return mk(
          anyOnFloor.userId,
          'floor.any',
          'floor assignment (non-primary or only candidate)',
        );
      }
    }
  }

  // Step 3 — anyone with this role in the building, opt-out by availability.
  const roleRows = await prisma.buildingRoleAssignment.findMany({
    where: {
      tenantId: input.tenantId,
      buildingId: input.buildingId,
      roleKey: input.roleKey,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    select: { userId: true, delegatedAt: true },
    orderBy: { delegatedAt: 'asc' },
  });

  if (roleRows.length > 0) {
    const userIds = roleRows.map((r) => r.userId);
    const unavailable = await loadUnavailable(prisma, input.tenantId, userIds, on);
    const candidate = roleRows.find((r) => !unavailable.has(r.userId));
    if (candidate) {
      return mk(candidate.userId, 'building.role', 'building-wide role fallback');
    }
  }

  // Step 4 — nobody matched.
  return mk(null, 'manager_queue', 'no eligible assignee found — routed to manager queue');
}

async function loadUnavailable(
  prisma: ResolverPrisma,
  tenantId: string,
  userIds: string[],
  on: Date,
): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const rows = await prisma.userAvailability.findMany({
    where: { tenantId, userId: { in: userIds }, date: on },
    select: { userId: true, status: true },
  });
  const out = new Set<string>();
  for (const r of rows) {
    if (UNAVAILABLE_STATUSES.has(String(r.status).toLowerCase())) out.add(r.userId);
  }
  return out;
}

function mk(userId: string | null, source: AssignmentSource, reason: string): AssignmentOutput {
  return { userId, source, reason };
}

@Injectable()
export class AssignmentResolverService {
  constructor(private readonly prisma: PrismaService) {}

  resolve(input: AssignmentInput): Promise<AssignmentOutput> {
    return resolveAssignment(this.prisma as unknown as ResolverPrisma, input);
  }
}
