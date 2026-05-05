import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class RoleDashboardsService {
  constructor(private readonly prisma: PrismaService) {}

  private async resolveBuilding(tenantId: string, idOrSlug: string) {
    const b = await this.prisma.building.findFirst({
      where: { tenantId, OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
    });
    if (!b) throw new NotFoundException('building not found');
    return b;
  }

  /** Building Manager — "today" view: urgent PPM, active incidents, pending approvals, reopened requests. */
  async buildingManagerToday(tenantId: string, buildingIdOrSlug: string) {
    const building = await this.resolveBuilding(tenantId, buildingIdOrSlug);
    const now = new Date();
    const in14 = new Date(now.getTime() + 14 * 86400000);

    // PERF-001 Stage 2 + 2026-05-05 KPI consolidation — every read
    // inside one RLS transaction. The KPI counters (6 cheap aggregate
    // queries: ppmPrograms / ppmOverdue / ppmDue30 / approvalsPending
    // / servicesOpen / incidentsOpen) used to be 5 separate calls
    // from OpsOverview, each with its own RLS transaction. Folding
    // them into this same withTenant batch eliminates 5 cross-process
    // round-trips on every dashboard load.
    const in30 = new Date(now.getTime() + 30 * 86400000);
    const {
      urgentDue,
      ppmInFlight,
      incidents,
      serviceOpen,
      approvals,
      openTasks,
      ppmProgramsCount,
      ppmOverdueCount,
      ppmDue30Count,
      approvalsPendingCount,
      servicesOpenCount,
      incidentsOpenCount,
    } = await this.prisma.withTenant(
      tenantId,
      async (tx) => {
        const urgentDue = await tx.ppmPlanItem.findMany({
          where: { tenantId, buildingId: building.id, nextDueAt: { lte: in14 } },
          include: { template: { select: { name: true, executionMode: true } } },
          orderBy: { nextDueAt: 'asc' },
          take: 20,
        });
        const ppmInFlight = await tx.taskInstance.count({
          where: {
            tenantId,
            buildingId: building.id,
            lifecycleStage: {
              in: [
                'quote_requested',
                'quote_received',
                'awaiting_approval',
                'approved',
                'ordered',
                'in_progress',
              ],
            },
          },
        });
        const incidents = await tx.incident.findMany({
          where: {
            tenantId,
            buildingId: building.id,
            status: { in: ['new', 'triaged', 'dispatched'] },
          },
          orderBy: [{ severity: 'asc' }, { reportedAt: 'desc' }],
          take: 10,
        });
        const serviceOpen = await tx.serviceRequest.findMany({
          where: { tenantId, buildingId: building.id, status: { in: ['new', 'triaged'] } },
          orderBy: { createdAt: 'desc' },
          take: 10,
        });
        const approvals = await tx.approvalRequest.findMany({
          where: { tenantId, buildingId: building.id, status: 'pending' },
          include: { steps: { orderBy: { orderNo: 'asc' } } },
          orderBy: { createdAt: 'desc' },
          take: 10,
        });
        const openTasks = await tx.taskInstance.count({
          where: { tenantId, buildingId: building.id, status: { in: ['open', 'overdue'] } },
        });

        // ── KPI counters (6 cheap aggregates) ──
        // ppmProgramsCount — templates with at least one baseline-
        // confirmed plan item (same filter listPrograms uses).
        const ppmProgramsCount = await tx.ppmTemplate.count({
          where: {
            tenantId,
            buildingId: building.id,
            planItems: { some: { baselineStatus: { not: 'pending' } } },
          },
        });
        const ppmOverdueCount = await tx.ppmPlanItem.count({
          where: { tenantId, buildingId: building.id, nextDueAt: { lt: now } },
        });
        const ppmDue30Count = await tx.ppmPlanItem.count({
          where: {
            tenantId,
            buildingId: building.id,
            nextDueAt: { gte: now, lte: in30 },
          },
        });
        const approvalsPendingCount = await tx.approvalRequest.count({
          where: { tenantId, buildingId: building.id, status: 'pending' },
        });
        const servicesOpenCount = await tx.serviceRequest.count({
          where: {
            tenantId,
            buildingId: building.id,
            status: { in: ['new', 'triaged'] },
          },
        });
        const incidentsOpenCount = await tx.incident.count({
          where: {
            tenantId,
            buildingId: building.id,
            status: { in: ['new', 'triaged', 'dispatched'] },
          },
        });

        return {
          urgentDue,
          ppmInFlight,
          incidents,
          serviceOpen,
          approvals,
          openTasks,
          ppmProgramsCount,
          ppmOverdueCount,
          ppmDue30Count,
          approvalsPendingCount,
          servicesOpenCount,
          incidentsOpenCount,
        };
      },
      'role-dashboards.buildingManagerToday',
    );

    return {
      building: { id: building.id, slug: building.slug, name: building.name },
      urgentDue: urgentDue.map((p) => ({
        planItemId: p.id,
        name: p.template.name,
        executionMode: p.template.executionMode,
        nextDueAt: p.nextDueAt,
        lastPerformedAt: p.lastPerformedAt,
        overdue: p.nextDueAt.getTime() < now.getTime(),
      })),
      ppmInFlight,
      incidents: incidents.map((i) => ({
        id: i.id,
        title: i.title,
        severity: i.severity,
        status: i.status,
        reportedAt: i.reportedAt,
      })),
      serviceRequests: serviceOpen.map((r) => ({
        id: r.id,
        category: r.category,
        priority: r.priority,
        status: r.status,
        createdAt: r.createdAt,
        description: r.description,
      })),
      pendingApprovals: approvals.map((a) => ({
        id: a.id,
        title: a.title,
        type: a.type,
        amount: a.amount,
        step: a.steps.findIndex((s) => s.status === 'pending') + 1,
        totalSteps: a.steps.length,
      })),
      openTasks,
      // 2026-05-05 KPI consolidation. Replaces the 5 separate calls
      // OpsOverview used to make (ppm/programs, ppm/calendar,
      // approvals, service-requests, incidents). All counters come
      // from the same withTenant batch above — one RLS transaction.
      kpiCounts: {
        ppmPrograms: ppmProgramsCount,
        ppmOverdue: ppmOverdueCount,
        ppmDue30: ppmDue30Count,
        approvalsPending: approvalsPendingCount,
        servicesOpen: servicesOpenCount,
        incidentsOpen: incidentsOpenCount,
      },
    };
  }

  /** Technician — "my queue": next due items where actor is assigned (by user or by role). */
  async technicianQueue(tenantId: string, actorUserId: string, buildingIdOrSlug?: string) {
    const building = buildingIdOrSlug
      ? await this.resolveBuilding(tenantId, buildingIdOrSlug)
      : null;

    const myRoles = await this.prisma.buildingRoleAssignment.findMany({
      where: { tenantId, userId: actorUserId, ...(building ? { buildingId: building.id } : {}) },
      select: { roleKey: true, buildingId: true },
    });
    const roleKeys = [...new Set(myRoles.map((r) => r.roleKey))];
    const buildingIds = [...new Set(myRoles.map((r) => r.buildingId))];

    const plans = await this.prisma.ppmPlanItem.findMany({
      where: {
        tenantId,
        ...(building ? { buildingId: building.id } : { buildingId: { in: buildingIds } }),
        OR: [{ assignedUserId: actorUserId }, { assignedRole: { in: roleKeys } }],
      },
      include: {
        template: { select: { name: true, executionMode: true, evidenceDocTypeKey: true } },
      },
      orderBy: { nextDueAt: 'asc' },
      take: 25,
    });

    const activeTasks = await this.prisma.taskInstance.findMany({
      where: {
        tenantId,
        ...(building ? { buildingId: building.id } : { buildingId: { in: buildingIds } }),
        OR: [{ completedByUserId: actorUserId }, { performerOrgId: { not: null } }],
        lifecycleStage: { in: ['scheduled', 'ordered', 'in_progress'] },
      },
      orderBy: { dueAt: 'asc' },
      take: 20,
    });

    return {
      actorUserId,
      rolesUsed: roleKeys,
      queue: plans.map((p) => ({
        planItemId: p.id,
        name: p.template.name,
        executionMode: p.template.executionMode,
        evidenceRequired: !!p.template.evidenceDocTypeKey,
        nextDueAt: p.nextDueAt,
      })),
      activeTasks: activeTasks.map((t) => ({
        id: t.id,
        title: t.title,
        lifecycleStage: t.lifecycleStage,
        dueAt: t.dueAt,
      })),
    };
  }

  /**
   * Tenant representative self-service: the person signing for an occupant
   * company sees their leased units, active contract window, open service
   * requests they opened, next scheduled PPM visits that will affect their
   * space, and a legal-hold / notices inbox. Scoped by the user's
   * OrganizationMembership linkage to a BuildingOccupantCompany (matched by
   * email → user → organization_memberships → building_occupant_companies).
   */
  async tenantRepresentativeSelfService(tenantId: string, actorUserId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: actorUserId },
      select: { id: true, displayName: true, emailNormalized: true },
    });
    if (!user) throw new NotFoundException('user not found');

    // Primary linkage: explicit TenantRepresentative rows; fall back to email match
    // on BuildingOccupantCompany so legacy-imported tenants still see their data.
    const reps = await this.prisma.tenantRepresentative.findMany({
      where: { tenantId, userId: actorUserId, status: 'active' },
      select: { occupantCompanyId: true, role: true, buildingId: true },
    });
    const explicitCompanyIds = [...new Set(reps.map((r) => r.occupantCompanyId))];
    const occupantCompanies = await this.prisma.buildingOccupantCompany.findMany({
      where: {
        tenantId,
        OR: [
          ...(explicitCompanyIds.length ? [{ id: { in: explicitCompanyIds } }] : []),
          { email: user.emailNormalized },
        ],
      },
      select: { id: true, buildingId: true, companyName: true, email: true, contactName: true },
    });

    if (occupantCompanies.length === 0) {
      return {
        actor: { userId: actorUserId, displayName: user.displayName, email: user.emailNormalized },
        occupancies: [],
        contracts: [],
        openRequests: [],
        upcomingPpm: [],
        notices: [],
        empty: true,
        reason: 'no occupant company linked to this user',
      };
    }

    const companyIds = occupantCompanies.map((c) => c.id);
    const buildingIds = [...new Set(occupantCompanies.map((c) => c.buildingId))];

    const [occupancies, contracts, openIncidents, openSRs, upcomingPpm, buildings] =
      await Promise.all([
        this.prisma.buildingUnitOccupancy.findMany({
          where: { tenantId, occupantCompanyId: { in: companyIds }, occupancyStatus: 'active' },
          include: {
            unit: {
              select: { id: true, unitCode: true, unitType: true, areaSqm: true, floorId: true },
            },
          },
        }),
        this.prisma.buildingContract.findMany({
          where: { tenantId, occupantCompanyId: { in: companyIds } },
          orderBy: { startDate: 'desc' },
          take: 20,
        }),
        this.prisma.incident.findMany({
          where: {
            tenantId,
            buildingId: { in: buildingIds },
            reportedBy: actorUserId,
            status: { in: ['new', 'triaged', 'dispatched'] },
          },
          orderBy: { reportedAt: 'desc' },
          take: 20,
        }),
        this.prisma.serviceRequest.findMany({
          where: {
            tenantId,
            buildingId: { in: buildingIds },
            submittedBy: actorUserId,
            status: { in: ['new', 'triaged', 'dispatched'] },
          },
          orderBy: { createdAt: 'desc' },
          take: 20,
        }),
        this.prisma.ppmPlanItem.findMany({
          where: {
            tenantId,
            buildingId: { in: buildingIds },
            nextDueAt: { gte: new Date(), lte: new Date(Date.now() + 30 * 86400000) },
            scope: { in: ['unit_scoped', 'building_common'] },
          },
          include: { template: { select: { name: true, executionMode: true } } },
          orderBy: { nextDueAt: 'asc' },
          take: 20,
        }),
        this.prisma.building.findMany({
          where: { tenantId, id: { in: buildingIds } },
          select: { id: true, slug: true, name: true },
        }),
      ]);

    const buildingById = new Map(buildings.map((b) => [b.id, b]));
    const openRequests = [
      ...openIncidents.map((i) => ({
        kind: 'incident' as const,
        id: i.id,
        title: i.title,
        severity: i.severity,
        status: i.status,
        reportedAt: i.reportedAt,
        buildingId: i.buildingId,
        buildingName: buildingById.get(i.buildingId)?.name ?? null,
      })),
      ...openSRs.map((r) => ({
        kind: 'service_request' as const,
        id: r.id,
        title: r.category,
        severity: null,
        priority: r.priority,
        status: r.status,
        reportedAt: r.createdAt,
        buildingId: r.buildingId,
        buildingName: buildingById.get(r.buildingId)?.name ?? null,
      })),
    ];

    return {
      actor: { userId: actorUserId, displayName: user.displayName, email: user.emailNormalized },
      companies: occupantCompanies,
      occupancies: occupancies.map((o) => ({
        id: o.id,
        unit: o.unit,
        buildingId: o.buildingId,
        buildingName: buildingById.get(o.buildingId)?.name ?? null,
        startDate: o.startDate,
        endDate: o.endDate,
      })),
      contracts: contracts.map((c) => ({
        id: c.id,
        contractType: c.contractType,
        contractNumber: c.contractNumber,
        startDate: c.startDate,
        endDate: c.endDate,
        status: c.status,
        amount: c.amount,
        currency: c.currency,
        buildingId: c.buildingId,
        buildingName: buildingById.get(c.buildingId)?.name ?? null,
      })),
      openRequests,
      upcomingPpm: upcomingPpm.map((p) => ({
        id: p.id,
        name: p.template.name,
        executionMode: p.template.executionMode,
        nextDueAt: p.nextDueAt,
        scope: p.scope,
        buildingId: p.buildingId,
        buildingName: buildingById.get(p.buildingId)?.name ?? null,
      })),
      notices: [],
    };
  }

  /** FM Director — portfolio view across the active tenant. */
  async fmDirectorPortfolio(tenantId: string) {
    const buildings = await this.prisma.building.findMany({
      where: { tenantId },
      select: { id: true, slug: true, name: true },
    });
    const buildingIds = buildings.map((b) => b.id);

    const [ppmPlans, incidents, approvals] = await Promise.all([
      this.prisma.ppmPlanItem.findMany({
        where: { tenantId, buildingId: { in: buildingIds } },
        select: { id: true, buildingId: true, nextDueAt: true },
      }),
      this.prisma.incident.groupBy({
        by: ['buildingId', 'status'],
        _count: { _all: true },
        where: { tenantId, buildingId: { in: buildingIds } },
      }),
      this.prisma.approvalRequest.groupBy({
        by: ['buildingId', 'status'],
        _count: { _all: true },
        where: { tenantId, buildingId: { in: buildingIds } },
      }),
    ]);

    const now = Date.now();
    const ppmOverdue = new Map<string, number>();
    const ppmDue30 = new Map<string, number>();
    for (const p of ppmPlans) {
      const t = p.nextDueAt.getTime() - now;
      if (t < 0) ppmOverdue.set(p.buildingId, (ppmOverdue.get(p.buildingId) || 0) + 1);
      else if (t < 30 * 86400000) ppmDue30.set(p.buildingId, (ppmDue30.get(p.buildingId) || 0) + 1);
    }

    return {
      totals: {
        buildings: buildings.length,
        ppmPrograms: ppmPlans.length,
        ppmOverdue: [...ppmOverdue.values()].reduce((a, b) => a + b, 0),
        ppmDue30: [...ppmDue30.values()].reduce((a, b) => a + b, 0),
        incidentsOpen: incidents
          .filter((i) => ['new', 'triaged', 'dispatched'].includes(i.status))
          .reduce((a, b) => a + b._count._all, 0),
        approvalsPending: approvals
          .filter((a) => a.status === 'pending')
          .reduce((a, b) => a + b._count._all, 0),
      },
      byBuilding: buildings.map((b) => ({
        building: b,
        ppmOverdue: ppmOverdue.get(b.id) || 0,
        ppmDue30: ppmDue30.get(b.id) || 0,
        incidentsOpen: incidents
          .filter(
            (x) => x.buildingId === b.id && ['new', 'triaged', 'dispatched'].includes(x.status),
          )
          .reduce((a, c) => a + c._count._all, 0),
        approvalsPending: approvals
          .filter((x) => x.buildingId === b.id && x.status === 'pending')
          .reduce((a, c) => a + c._count._all, 0),
      })),
    };
  }
}
