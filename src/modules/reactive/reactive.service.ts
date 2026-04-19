import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ReactiveService {
  constructor(private readonly prisma: PrismaService) {}

  private async resolveBuildingId(tenantId: string, idOrSlug: string): Promise<string> {
    const b = await this.prisma.building.findFirst({
      where: { tenantId, OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
      select: { id: true },
    });
    if (!b) throw new NotFoundException('building not found');
    return b.id;
  }

  private async assertManager(tenantId: string, actorUserId: string, buildingId: string) {
    const ws = await this.prisma.membership.findFirst({
      where: { tenantId, userId: actorUserId, roleKey: { in: ['workspace_owner', 'workspace_admin', 'org_admin'] } },
    });
    if (ws) return;
    const br = await this.prisma.buildingRoleAssignment.findFirst({
      where: { tenantId, userId: actorUserId, buildingId, roleKey: { in: ['building_manager', 'chief_engineer', 'maintenance_coordinator', 'finance_controller'] } },
    });
    if (!br) throw new ForbiddenException('not authorized for this building');
  }

  // ─── Incidents ─────────────────────────────────────────────
  async createIncident(
    tenantId: string, actorUserId: string | null, buildingIdOrSlug: string,
    body: { title: string; description?: string; severity: 'P1'|'P2'|'P3'|'P4'; origin: string; unitId?: string; equipmentId?: string; reportedBy?: string },
  ) {
    if (!body.title || !body.severity || !body.origin) throw new BadRequestException('title, severity, origin required');
    const buildingId = await this.resolveBuildingId(tenantId, buildingIdOrSlug);
    return this.prisma.incident.create({
      data: {
        tenantId, buildingId,
        title: body.title, description: body.description || null,
        severity: body.severity, origin: body.origin, status: 'new',
        unitId: body.unitId || null, equipmentId: body.equipmentId || null,
        reportedBy: body.reportedBy || actorUserId || null,
      },
    });
  }

  async listIncidents(tenantId: string, buildingIdOrSlug: string, filter?: { status?: string; severity?: string }) {
    const buildingId = await this.resolveBuildingId(tenantId, buildingIdOrSlug);
    return this.prisma.incident.findMany({
      where: { tenantId, buildingId, status: filter?.status || undefined, severity: filter?.severity || undefined },
      orderBy: [{ severity: 'asc' }, { reportedAt: 'desc' }],
    });
  }

  async ackIncident(tenantId: string, actorUserId: string, id: string) {
    const inc = await this.prisma.incident.findFirst({ where: { id, tenantId } });
    if (!inc) throw new NotFoundException('incident not found');
    await this.assertManager(tenantId, actorUserId, inc.buildingId);
    if (inc.ackedAt) return inc;
    return this.prisma.incident.update({
      where: { id }, data: { status: 'triaged', ackedAt: new Date() },
    });
  }

  async resolveIncident(
    tenantId: string, actorUserId: string, id: string,
    body: { rootCause: string; preventiveAction?: string },
  ) {
    if (!body.rootCause) throw new BadRequestException('rootCause required to archive an incident');
    const inc = await this.prisma.incident.findFirst({ where: { id, tenantId } });
    if (!inc) throw new NotFoundException('incident not found');
    await this.assertManager(tenantId, actorUserId, inc.buildingId);
    return this.prisma.incident.update({
      where: { id },
      data: {
        status: 'resolved',
        resolvedAt: new Date(),
        rootCause: body.rootCause,
        preventiveAction: body.preventiveAction || null,
      },
    });
  }

  // ─── Service requests ──────────────────────────────────────
  async createServiceRequest(
    tenantId: string, actorUserId: string | null, buildingIdOrSlug: string,
    body: { category: string; priority?: 'low'|'normal'|'high'; description?: string; unitId?: string; qrLocationId?: string; photoKey?: string; submittedBy?: string; submitterContact?: string },
  ) {
    if (!body.category) throw new BadRequestException('category required');
    const buildingId = await this.resolveBuildingId(tenantId, buildingIdOrSlug);
    return this.prisma.serviceRequest.create({
      data: {
        tenantId, buildingId,
        category: body.category,
        priority: body.priority || 'normal',
        status: 'new',
        description: body.description || null,
        unitId: body.unitId || null,
        qrLocationId: body.qrLocationId || null,
        photoKey: body.photoKey || null,
        submittedBy: body.submittedBy || actorUserId || null,
        submitterContact: body.submitterContact || null,
      },
    });
  }

  async listServiceRequests(tenantId: string, buildingIdOrSlug: string, filter?: { status?: string; category?: string }) {
    const buildingId = await this.resolveBuildingId(tenantId, buildingIdOrSlug);
    return this.prisma.serviceRequest.findMany({
      where: { tenantId, buildingId, status: filter?.status || undefined, category: filter?.category || undefined },
      orderBy: { createdAt: 'desc' },
    });
  }

  async resolveServiceRequest(
    tenantId: string, actorUserId: string, id: string,
    body: { resolutionCode: string; note?: string },
  ) {
    if (!body.resolutionCode) throw new BadRequestException('resolutionCode required');
    const sr = await this.prisma.serviceRequest.findFirst({ where: { id, tenantId } });
    if (!sr) throw new NotFoundException('service request not found');
    await this.assertManager(tenantId, actorUserId, sr.buildingId);
    return this.prisma.serviceRequest.update({
      where: { id },
      data: { status: 'resolved', resolutionCode: body.resolutionCode },
    });
  }

  // ─── Convert intake → WorkOrder ────────────────────────────
  async convertToWorkOrder(
    tenantId: string, actorUserId: string,
    body: { source: 'incident' | 'service_request'; sourceId: string; vendorOrgId?: string; dueAt?: string },
  ) {
    if (!body.source || !body.sourceId) throw new BadRequestException('source + sourceId required');
    const rec = body.source === 'incident'
      ? await this.prisma.incident.findFirst({ where: { id: body.sourceId, tenantId } })
      : await this.prisma.serviceRequest.findFirst({ where: { id: body.sourceId, tenantId } });
    if (!rec) throw new NotFoundException('source not found');
    await this.assertManager(tenantId, actorUserId, rec.buildingId);

    const wo = await this.prisma.workOrder.create({
      data: {
        tenantId, buildingId: rec.buildingId,
        vendorOrgId: body.vendorOrgId || null,
        status: 'dispatched',
        dueAt: body.dueAt ? new Date(body.dueAt) : new Date(Date.now() + 7 * 86400000),
      },
    });

    if (body.source === 'incident') {
      await this.prisma.incident.update({ where: { id: rec.id }, data: { status: 'dispatched', workOrderId: wo.id } });
    } else {
      await this.prisma.serviceRequest.update({ where: { id: rec.id }, data: { status: 'dispatched', workOrderId: wo.id } });
    }
    return wo;
  }

  // ─── Quote / PO / Completion ───────────────────────────────
  async createQuote(
    tenantId: string, actorUserId: string,
    body: { buildingIdOrSlug: string; workOrderId?: string; vendorOrgId?: string; title: string; description?: string; amount: number; currency?: string; validUntil?: string; revisionOf?: string; documentId?: string },
  ) {
    if (!body.title || body.amount === undefined) throw new BadRequestException('title, amount required');
    const buildingId = await this.resolveBuildingId(tenantId, body.buildingIdOrSlug);
    await this.assertManager(tenantId, actorUserId, buildingId);

    if (body.revisionOf) {
      const prev = await this.prisma.quote.findFirst({ where: { id: body.revisionOf, tenantId } });
      if (prev) {
        await this.prisma.quote.update({ where: { id: prev.id }, data: { status: 'superseded' } });
      }
    }

    return this.prisma.quote.create({
      data: {
        tenantId, buildingId,
        workOrderId: body.workOrderId || null,
        vendorOrgId: body.vendorOrgId || null,
        requesterUserId: actorUserId,
        title: body.title, description: body.description || null,
        amount: body.amount, currency: body.currency || 'ILS',
        validUntil: body.validUntil ? new Date(body.validUntil) : null,
        status: 'received',
        revisionOf: body.revisionOf || null,
        documentId: body.documentId || null,
        receivedAt: new Date(),
      },
    });
  }

  async issuePurchaseOrder(
    tenantId: string, actorUserId: string,
    body: { quoteId?: string; workOrderId?: string; buildingIdOrSlug: string; poNumber?: string; vendorOrgId?: string; budgetLineId?: string; amount: number; currency?: string; expectedDeliveryAt?: string; capexOpex?: 'capex'|'opex'; notes?: string },
  ) {
    if (body.amount === undefined) throw new BadRequestException('amount required');
    const buildingId = await this.resolveBuildingId(tenantId, body.buildingIdOrSlug);
    await this.assertManager(tenantId, actorUserId, buildingId);

    let quote = null as any;
    if (body.quoteId) {
      quote = await this.prisma.quote.findFirst({ where: { id: body.quoteId, tenantId } });
      if (!quote) throw new BadRequestException('quote not found');
      if (quote.status !== 'approved') throw new BadRequestException('quote must be approved before issuing PO');
      // SoD: PO issuer must not be the quote requester.
      if (quote.requesterUserId === actorUserId) {
        throw new ForbiddenException('separation_of_duties: quote requester cannot issue the PO for their own quote');
      }
    }

    const poNumber = body.poNumber || `PO-${Date.now()}`;
    const po = await this.prisma.purchaseOrder.create({
      data: {
        tenantId, buildingId,
        poNumber,
        quoteId: body.quoteId || null,
        workOrderId: body.workOrderId || quote?.workOrderId || null,
        vendorOrgId: body.vendorOrgId || quote?.vendorOrgId || null,
        budgetLineId: body.budgetLineId || null,
        amount: body.amount,
        currency: body.currency || 'ILS',
        status: 'issued',
        expectedDeliveryAt: body.expectedDeliveryAt ? new Date(body.expectedDeliveryAt) : null,
        issuedByUserId: actorUserId,
        capexOpex: body.capexOpex || null,
        notes: body.notes || null,
      },
    });

    if (quote) {
      await this.prisma.quote.update({ where: { id: quote.id }, data: { approvalRequestId: quote.approvalRequestId || null } });
    }
    return po;
  }

  async recordCompletion(
    tenantId: string, actorUserId: string,
    body: {
      buildingIdOrSlug: string;
      workOrderId?: string;
      taskInstanceId?: string;
      completedAt?: string;
      labourHours?: number; labourCost?: number; materialsCost?: number; downtimeMinutes?: number;
      serviceReportDocumentId?: string;
      photoDocumentIds?: string[];
      notes?: string;
    },
  ) {
    const buildingId = await this.resolveBuildingId(tenantId, body.buildingIdOrSlug);
    await this.assertManager(tenantId, actorUserId, buildingId);

    // Hard-stop: if linked WO has an associated PO and no evidence, block.
    if (body.workOrderId) {
      const po = await this.prisma.purchaseOrder.findFirst({ where: { workOrderId: body.workOrderId, status: { in: ['issued', 'in_progress'] } } });
      const hasEvidence = !!body.serviceReportDocumentId || (body.photoDocumentIds && body.photoDocumentIds.length > 0);
      if (po && !hasEvidence) {
        throw new BadRequestException('external work with PO cannot be closed without completion documents');
      }
    }

    return this.prisma.completionRecord.create({
      data: {
        tenantId, buildingId,
        workOrderId: body.workOrderId || null,
        taskInstanceId: body.taskInstanceId || null,
        completedByUserId: actorUserId,
        completedAt: body.completedAt ? new Date(body.completedAt) : new Date(),
        labourHours: body.labourHours ?? null,
        labourCost: body.labourCost ?? null,
        materialsCost: body.materialsCost ?? null,
        downtimeMinutes: body.downtimeMinutes ?? null,
        serviceReportDocumentId: body.serviceReportDocumentId || null,
        photoDocumentIds: body.photoDocumentIds || [],
        notes: body.notes || null,
      },
    });
  }

  // ─── Triage queue (portfolio-wide reception / service desk) ───────────
  //
  // SLA targets by severity / priority (hours):
  //   P1 / high           → 1h  ack, 4h  resolve
  //   P2 / normal         → 4h  ack, 24h resolve
  //   P3 / low            → 24h ack, 72h resolve
  //   P4                  → 72h ack, 7d  resolve
  //
  // `slaDueAt` is computed relative to the open time (reportedAt / createdAt);
  // `slaBreached` is true once the resolve target has passed while still open.
  async triageQueue(tenantId: string, params: { buildingId?: string; status?: string } = {}) {
    const openIncidentStatuses = ['new', 'triaged', 'dispatched'];
    const openSrStatuses = ['new', 'triaged', 'dispatched'];
    const filterStatus = params.status && params.status !== 'open' ? [params.status] : openIncidentStatuses;

    const where: any = { tenantId, status: { in: filterStatus } };
    if (params.buildingId) where.buildingId = params.buildingId;

    const [incidents, serviceRequests, buildings] = await Promise.all([
      this.prisma.incident.findMany({
        where,
        orderBy: [{ severity: 'asc' }, { reportedAt: 'asc' }],
        take: 200,
      }),
      this.prisma.serviceRequest.findMany({
        where: {
          ...where,
          status: { in: params.status && params.status !== 'open' ? [params.status] : openSrStatuses },
        },
        orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
        take: 200,
      }),
      this.prisma.building.findMany({
        where: { tenantId, ...(params.buildingId ? { id: params.buildingId } : {}) },
        select: { id: true, slug: true, name: true },
      }),
    ]);

    const buildingById = new Map(buildings.map((b) => [b.id, b]));
    const now = Date.now();
    const SLA = {
      P1: { ack: 1, resolve: 4 },
      P2: { ack: 4, resolve: 24 },
      P3: { ack: 24, resolve: 72 },
      P4: { ack: 72, resolve: 168 },
    } as const;
    const SLA_PRIO = {
      high: { ack: 1, resolve: 4 },
      normal: { ack: 4, resolve: 24 },
      low: { ack: 24, resolve: 72 },
    } as const;

    const incidentItems = incidents.map((i) => {
      const b = buildingById.get(i.buildingId);
      const openedAt = i.reportedAt.getTime();
      const sla = SLA[i.severity as keyof typeof SLA] ?? SLA.P3;
      const ackDueAt = new Date(openedAt + sla.ack * 3600000);
      const resolveDueAt = new Date(openedAt + sla.resolve * 3600000);
      return {
        kind: 'incident' as const,
        id: i.id, title: i.title, description: i.description,
        severity: i.severity, priority: null, category: i.origin,
        status: i.status,
        buildingId: i.buildingId, buildingName: b?.name || null, buildingSlug: b?.slug || null,
        reportedAt: i.reportedAt.toISOString(),
        reportedBy: i.reportedBy,
        ackedAt: i.ackedAt ? i.ackedAt.toISOString() : null,
        ackDueAt: ackDueAt.toISOString(),
        resolveDueAt: resolveDueAt.toISOString(),
        ageMinutes: Math.round((now - openedAt) / 60000),
        ackBreached: !i.ackedAt && now > ackDueAt.getTime(),
        slaBreached: now > resolveDueAt.getTime(),
      };
    });

    const srItems = serviceRequests.map((r) => {
      const b = buildingById.get(r.buildingId);
      const openedAt = r.createdAt.getTime();
      const sla = SLA_PRIO[r.priority as keyof typeof SLA_PRIO] ?? SLA_PRIO.normal;
      const ackDueAt = new Date(openedAt + sla.ack * 3600000);
      const resolveDueAt = new Date(openedAt + sla.resolve * 3600000);
      return {
        kind: 'service_request' as const,
        id: r.id, title: r.category, description: r.description,
        severity: null, priority: r.priority, category: r.category,
        status: r.status,
        buildingId: r.buildingId, buildingName: b?.name || null, buildingSlug: b?.slug || null,
        reportedAt: r.createdAt.toISOString(),
        reportedBy: r.submittedBy,
        ackedAt: null,
        ackDueAt: ackDueAt.toISOString(),
        resolveDueAt: resolveDueAt.toISOString(),
        ageMinutes: Math.round((now - openedAt) / 60000),
        ackBreached: now > ackDueAt.getTime(),
        slaBreached: now > resolveDueAt.getTime(),
      };
    });

    const items = [...incidentItems, ...srItems].sort((a, b) => {
      // Breached first; then earliest resolveDueAt.
      if (a.slaBreached !== b.slaBreached) return a.slaBreached ? -1 : 1;
      return a.resolveDueAt.localeCompare(b.resolveDueAt);
    });

    return {
      buckets: {
        total: items.length,
        breached: items.filter((i) => i.slaBreached).length,
        dueSoon: items.filter((i) => !i.slaBreached && new Date(i.resolveDueAt).getTime() - now < 4 * 3600000).length,
        newUnacked: items.filter((i) => i.status === 'new').length,
        bySeverity: {
          P1: incidentItems.filter((i) => i.severity === 'P1').length,
          P2: incidentItems.filter((i) => i.severity === 'P2').length,
          P3: incidentItems.filter((i) => i.severity === 'P3').length,
          P4: incidentItems.filter((i) => i.severity === 'P4').length,
        },
        serviceRequests: srItems.length,
      },
      items,
    };
  }
}
