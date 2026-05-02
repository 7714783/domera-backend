import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { requireManager, resolveBuildingId } from '../../common/building.helpers';
import { AssignmentResolverService } from '../assignment/assignment.resolver';
import { ActorResolver } from '../../common/authz';
import { AuditService } from '../audit/audit.service';
import { OutboxRegistry } from '../events/outbox.registry';

// INIT-007 Phase 4 — narrowing list responses by tenantCompany /
// createdByScope. Returns extra `where` keys to merge into the Prisma
// query when the actor's role grants demand it.
type ListNarrow = {
  byCompany?: string;
  bySelf?: string; // userId — caller picks the right column (submittedBy vs reportedBy)
};

const COMPANY_SCOPED_PERMS = ['tasks.view_company'];

@Injectable()
export class ReactiveService implements OnModuleInit {
  private readonly log = new Logger(ReactiveService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly assignmentResolver: AssignmentResolverService,
    private readonly actorResolver: ActorResolver,
    private readonly audit: AuditService,
    private readonly outboxRegistry: OutboxRegistry,
  ) {}

  // INIT-012 P1 chiller canary — second slice. PPM inspector requested
  // vendor expense (TaskInstance flagged check_failed with quoteAmount).
  // We spawn a WorkOrder linked to that TaskInstance so the vendor
  // dispatch flow can pick it up. Status starts at `pending_approval`
  // — the approvals subscriber on the same event creates the
  // ApprovalRequest, and on approval.granted we move WO to dispatched.
  // Idempotent: dedup on taskInstanceId — if a WO already exists for
  // this task we skip (replay-safe).
  onModuleInit() {
    this.outboxRegistry.register('ppm.expense.requested', async (event) => {
      const taskId = event.subject;
      const payload = (event.payload || {}) as Record<string, any>;
      const tenantId: string | undefined = payload.tenantId;
      const buildingId: string | undefined = payload.buildingId;
      if (!tenantId || !buildingId) {
        this.log.warn(`ppm.expense.requested missing tenantId/buildingId for task ${taskId}`);
        return;
      }
      const existing = await this.prisma.workOrder.findFirst({
        where: { tenantId, taskInstanceId: taskId },
        select: { id: true },
      });
      if (existing) {
        this.log.debug(
          `ppm.expense.requested replay — WO ${existing.id} already exists for task ${taskId}`,
        );
        return;
      }
      const wo = await this.prisma.workOrder.create({
        data: {
          tenantId,
          buildingId,
          taskInstanceId: taskId,
          vendorOrgId: payload.vendorOrgId ?? null,
          status: 'pending_approval',
          dueAt: new Date(Date.now() + 14 * 86400000),
        },
      });
      await this.audit.transition({
        tenantId,
        actor: 'system',
        actorRole: 'system',
        entityType: 'work_order',
        entityId: wo.id,
        from: null,
        to: 'pending_approval',
        buildingId,
        metadata: {
          source: 'ppm.expense.requested',
          taskInstanceId: taskId,
          amount: payload.amount,
          currency: payload.currency,
          reason: payload.reason,
        },
      });
    });

    // INIT-012 P1 chiller canary — third slice. When the originating
    // task_expense ApprovalRequest is granted, flip the matching
    // WorkOrder pending_approval → dispatched. We resolve the link via
    // the approval's `hint` field (convention: 'task:<taskInstanceId>')
    // set by the approvals subscriber on ppm.expense.requested. No
    // direct DI — purely event-driven, idempotent on status mismatch.
    this.outboxRegistry.register('approval.granted', async (event) => {
      const payload = (event.payload || {}) as Record<string, any>;
      if (payload.type !== 'task_expense') return;
      const hint: string | undefined = payload.hint;
      if (!hint || !hint.startsWith('task:')) {
        this.log.debug(`approval.granted ${event.subject}: hint missing/non-task — skip`);
        return;
      }
      const taskId = hint.slice('task:'.length);
      const tenantId: string | undefined = payload.tenantId;
      if (!tenantId) return;
      const wo = await this.prisma.workOrder.findFirst({
        where: { tenantId, taskInstanceId: taskId, status: 'pending_approval' },
      });
      if (!wo) {
        this.log.debug(`approval.granted ${event.subject}: no pending WO for task ${taskId}`);
        return;
      }
      await this.prisma.workOrder.update({
        where: { id: wo.id },
        data: { status: 'dispatched' },
      });
      await this.audit.transition({
        tenantId,
        actor: payload.grantedBy || 'system',
        actorRole: 'approver',
        entityType: 'work_order',
        entityId: wo.id,
        from: 'pending_approval',
        to: 'dispatched',
        buildingId: wo.buildingId,
        metadata: {
          source: 'approval.granted',
          approvalId: payload.approvalId,
          taskInstanceId: taskId,
        },
      });
    });
  }

  // INIT-007 Phase 4 — derive list-narrow flags from the actor.
  // Anonymous (no userId) gets no narrowing — controller-level guards or
  // tenant context decide whether the call is allowed at all. This helper
  // only NARROWS — never widens beyond what the controller already permits.
  private async narrowFor(
    tenantId: string,
    actorUserId: string | null,
    buildingId?: string,
  ): Promise<ListNarrow> {
    if (!actorUserId) return {};
    const actor = await this.actorResolver.resolve({ tenantId, userId: actorUserId, buildingId });
    if (actor.isSuperAdmin) return {};
    const out: ListNarrow = {};
    // tasks.view_all wins over tasks.view_company — if the persona can see
    // everything in the building, don't constrain by tenantCompany.
    const seesAll = actor.permissions.has('tasks.view_all');
    if (
      !seesAll &&
      actor.scope.tenantCompanyId &&
      COMPANY_SCOPED_PERMS.some((p) => actor.permissions.has(p))
    ) {
      out.byCompany = actor.scope.tenantCompanyId;
    }
    if (actor.scope.createdByScope === true) {
      out.bySelf = actorUserId;
    }
    return out;
  }

  private resolveBuildingId = (tenantId: string, idOrSlug: string) =>
    resolveBuildingId(this.prisma, tenantId, idOrSlug);

  // Reactive workflow lets maintenance_coordinator + finance_controller act
  // as building managers on incidents/service-requests (they dispatch + close
  // these) — pass them as extraBuildingRoles to the shared guard.
  private assertManager = (tenantId: string, actorUserId: string, buildingId: string) =>
    requireManager(this.prisma, tenantId, actorUserId, {
      buildingId,
      extraBuildingRoles: ['maintenance_coordinator', 'finance_controller'],
    });

  // ─── Incidents ─────────────────────────────────────────────
  async createIncident(
    tenantId: string,
    actorUserId: string | null,
    buildingIdOrSlug: string,
    body: {
      title: string;
      description?: string;
      severity: 'P1' | 'P2' | 'P3' | 'P4';
      origin: string;
      unitId?: string;
      floorId?: string;
      equipmentId?: string;
      reportedBy?: string;
      tenantCompanyId?: string;
    },
  ) {
    if (!body.title || !body.severity || !body.origin)
      throw new BadRequestException('title, severity, origin required');
    const buildingId = await this.resolveBuildingId(tenantId, buildingIdOrSlug);

    const floorId = await this.deriveFloorId(tenantId, body.floorId, body.unitId);
    const decision = await this.assignmentResolver.resolve({
      tenantId,
      buildingId,
      floorId,
      roleKey: 'technician',
    });

    const created = await this.prisma.incident.create({
      data: {
        tenantId,
        buildingId,
        title: body.title,
        description: body.description || null,
        severity: body.severity,
        origin: body.origin,
        status: 'new',
        unitId: body.unitId || null,
        floorId: floorId || null,
        equipmentId: body.equipmentId || null,
        reportedBy: body.reportedBy || actorUserId || null,
        tenantCompanyId: body.tenantCompanyId || null,
        assignedUserId: decision.userId,
        assignmentSource: decision.source,
        assignmentReason: decision.reason,
      },
    });
    await this.audit.transition({
      tenantId,
      actor: actorUserId || 'system',
      actorRole: 'reporter',
      entityType: 'incident',
      entityId: created.id,
      from: null,
      to: 'new',
      buildingId,
      metadata: {
        severity: created.severity,
        origin: created.origin,
        assignedUserId: created.assignedUserId,
        assignmentSource: created.assignmentSource,
      },
    });
    return created;
  }

  async listIncidents(
    tenantId: string,
    buildingIdOrSlug: string,
    filter?: { status?: string; severity?: string },
    actorUserId?: string | null,
  ) {
    const buildingId = await this.resolveBuildingId(tenantId, buildingIdOrSlug);
    const narrow = await this.narrowFor(tenantId, actorUserId ?? null, buildingId);
    return this.prisma.incident.findMany({
      where: {
        tenantId,
        buildingId,
        status: filter?.status || undefined,
        severity: filter?.severity || undefined,
        ...(narrow.byCompany ? { tenantCompanyId: narrow.byCompany } : {}),
        ...(narrow.bySelf ? { reportedBy: narrow.bySelf } : {}),
      },
      orderBy: [{ severity: 'asc' }, { reportedAt: 'desc' }],
    });
  }

  async ackIncident(tenantId: string, actorUserId: string, id: string) {
    const inc = await this.prisma.incident.findFirst({ where: { id, tenantId } });
    if (!inc) throw new NotFoundException('incident not found');
    await this.assertManager(tenantId, actorUserId, inc.buildingId);
    if (inc.ackedAt) return inc;
    const updated = await this.prisma.incident.update({
      where: { id },
      data: { status: 'triaged', ackedAt: new Date() },
    });
    await this.audit.transition({
      tenantId,
      actor: actorUserId,
      actorRole: 'manager',
      entityType: 'incident',
      entityId: id,
      from: inc.status,
      to: 'triaged',
      buildingId: inc.buildingId,
    });
    return updated;
  }

  async resolveIncident(
    tenantId: string,
    actorUserId: string,
    id: string,
    body: { rootCause: string; preventiveAction?: string },
  ) {
    if (!body.rootCause) throw new BadRequestException('rootCause required to archive an incident');
    const inc = await this.prisma.incident.findFirst({ where: { id, tenantId } });
    if (!inc) throw new NotFoundException('incident not found');
    await this.assertManager(tenantId, actorUserId, inc.buildingId);
    const updated = await this.prisma.incident.update({
      where: { id },
      data: {
        status: 'resolved',
        resolvedAt: new Date(),
        rootCause: body.rootCause,
        preventiveAction: body.preventiveAction || null,
      },
    });
    await this.audit.transition({
      tenantId,
      actor: actorUserId,
      actorRole: 'manager',
      entityType: 'incident',
      entityId: id,
      from: inc.status,
      to: 'resolved',
      buildingId: inc.buildingId,
      metadata: { rootCause: body.rootCause, preventiveAction: body.preventiveAction },
    });
    return updated;
  }

  // ─── Service requests ──────────────────────────────────────
  async createServiceRequest(
    tenantId: string,
    actorUserId: string | null,
    buildingIdOrSlug: string,
    body: {
      category: string;
      priority?: 'low' | 'normal' | 'high';
      description?: string;
      unitId?: string;
      floorId?: string;
      qrLocationId?: string;
      photoKey?: string;
      submittedBy?: string;
      submitterContact?: string;
      tenantCompanyId?: string;
    },
  ) {
    if (!body.category) throw new BadRequestException('category required');
    const buildingId = await this.resolveBuildingId(tenantId, buildingIdOrSlug);

    const floorId = await this.deriveFloorId(tenantId, body.floorId, body.unitId);
    const decision = await this.assignmentResolver.resolve({
      tenantId,
      buildingId,
      floorId,
      roleKey: 'technician',
    });

    const created = await this.prisma.serviceRequest.create({
      data: {
        tenantId,
        buildingId,
        category: body.category,
        priority: body.priority || 'normal',
        status: 'new',
        description: body.description || null,
        unitId: body.unitId || null,
        floorId: floorId || null,
        qrLocationId: body.qrLocationId || null,
        photoKey: body.photoKey || null,
        submittedBy: body.submittedBy || actorUserId || null,
        submitterContact: body.submitterContact || null,
        tenantCompanyId: body.tenantCompanyId || null,
        assignedUserId: decision.userId,
        assignmentSource: decision.source,
        assignmentReason: decision.reason,
      },
    });
    await this.audit.transition({
      tenantId,
      actor: actorUserId || 'system',
      actorRole: 'submitter',
      entityType: 'service_request',
      entityId: created.id,
      from: null,
      to: 'new',
      buildingId,
      metadata: {
        category: created.category,
        priority: created.priority,
        assignedUserId: created.assignedUserId,
        assignmentSource: created.assignmentSource,
      },
    });
    return created;
  }

  // Best-effort floorId derivation: explicit body.floorId wins, otherwise
  // try to find it from the unit. Returns null when nothing is known —
  // resolver still works, it just skips floor-specific candidates.
  private async deriveFloorId(
    tenantId: string,
    floorId: string | undefined | null,
    unitId: string | undefined | null,
  ): Promise<string | null> {
    if (floorId) return floorId;
    if (!unitId) return null;
    const unit = await this.prisma.buildingUnit.findFirst({
      where: { id: unitId, tenantId },
      select: { floorId: true },
    });
    return unit?.floorId || null;
  }

  async listServiceRequests(
    tenantId: string,
    buildingIdOrSlug: string,
    filter?: { status?: string; category?: string },
    actorUserId?: string | null,
  ) {
    const buildingId = await this.resolveBuildingId(tenantId, buildingIdOrSlug);
    const narrow = await this.narrowFor(tenantId, actorUserId ?? null, buildingId);
    return this.prisma.serviceRequest.findMany({
      where: {
        tenantId,
        buildingId,
        status: filter?.status || undefined,
        category: filter?.category || undefined,
        ...(narrow.byCompany ? { tenantCompanyId: narrow.byCompany } : {}),
        ...(narrow.bySelf ? { submittedBy: narrow.bySelf } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async resolveServiceRequest(
    tenantId: string,
    actorUserId: string,
    id: string,
    body: { resolutionCode: string; note?: string },
  ) {
    if (!body.resolutionCode) throw new BadRequestException('resolutionCode required');
    const sr = await this.prisma.serviceRequest.findFirst({ where: { id, tenantId } });
    if (!sr) throw new NotFoundException('service request not found');
    await this.assertManager(tenantId, actorUserId, sr.buildingId);
    const updated = await this.prisma.serviceRequest.update({
      where: { id },
      data: { status: 'resolved', resolutionCode: body.resolutionCode },
    });
    await this.audit.transition({
      tenantId,
      actor: actorUserId,
      actorRole: 'manager',
      entityType: 'service_request',
      entityId: id,
      from: sr.status,
      to: 'resolved',
      buildingId: sr.buildingId,
      metadata: { resolutionCode: body.resolutionCode },
    });
    return updated;
  }

  // ─── Manual (re)assignment of incidents + service-requests ───
  // Used by the triage manager-queue UI when the auto-resolver returns
  // null (assignmentSource === 'manager_queue') or when the manager
  // overrides the auto-pick. Idempotent — assigning the same user is a no-op.
  async assignIncident(
    tenantId: string,
    actorUserId: string,
    id: string,
    body: { userId: string },
  ) {
    if (!body?.userId) throw new BadRequestException('userId required');
    const inc = await this.prisma.incident.findFirst({ where: { id, tenantId } });
    if (!inc) throw new NotFoundException('incident not found');
    await this.assertManager(tenantId, actorUserId, inc.buildingId);
    const updated = await this.prisma.incident.update({
      where: { id },
      data: {
        assignedUserId: body.userId,
        assignmentSource: 'manager.manual',
        assignmentReason: `manually assigned by ${actorUserId}`,
      },
    });
    await this.audit.transition({
      tenantId,
      actor: actorUserId,
      actorRole: 'manager',
      entityType: 'incident',
      entityId: id,
      from: inc.assignedUserId || null,
      to: body.userId,
      buildingId: inc.buildingId,
      metadata: { kind: 'manual_assign', priorSource: inc.assignmentSource },
    });
    return updated;
  }

  async assignServiceRequest(
    tenantId: string,
    actorUserId: string,
    id: string,
    body: { userId: string },
  ) {
    if (!body?.userId) throw new BadRequestException('userId required');
    const sr = await this.prisma.serviceRequest.findFirst({ where: { id, tenantId } });
    if (!sr) throw new NotFoundException('service request not found');
    await this.assertManager(tenantId, actorUserId, sr.buildingId);
    const updated = await this.prisma.serviceRequest.update({
      where: { id },
      data: {
        assignedUserId: body.userId,
        assignmentSource: 'manager.manual',
        assignmentReason: `manually assigned by ${actorUserId}`,
      },
    });
    await this.audit.transition({
      tenantId,
      actor: actorUserId,
      actorRole: 'manager',
      entityType: 'service_request',
      entityId: id,
      from: sr.assignedUserId || null,
      to: body.userId,
      buildingId: sr.buildingId,
      metadata: { kind: 'manual_assign', priorSource: sr.assignmentSource },
    });
    return updated;
  }

  // ─── Convert intake → WorkOrder ────────────────────────────
  async convertToWorkOrder(
    tenantId: string,
    actorUserId: string,
    body: {
      source: 'incident' | 'service_request';
      sourceId: string;
      vendorOrgId?: string;
      dueAt?: string;
    },
  ) {
    if (!body.source || !body.sourceId) throw new BadRequestException('source + sourceId required');
    const rec =
      body.source === 'incident'
        ? await this.prisma.incident.findFirst({ where: { id: body.sourceId, tenantId } })
        : await this.prisma.serviceRequest.findFirst({ where: { id: body.sourceId, tenantId } });
    if (!rec) throw new NotFoundException('source not found');
    await this.assertManager(tenantId, actorUserId, rec.buildingId);

    const wo = await this.prisma.workOrder.create({
      data: {
        tenantId,
        buildingId: rec.buildingId,
        vendorOrgId: body.vendorOrgId || null,
        status: 'dispatched',
        dueAt: body.dueAt ? new Date(body.dueAt) : new Date(Date.now() + 7 * 86400000),
      },
    });
    await this.audit.transition({
      tenantId,
      actor: actorUserId,
      actorRole: 'manager',
      entityType: 'work_order',
      entityId: wo.id,
      from: null,
      to: 'dispatched',
      buildingId: rec.buildingId,
      metadata: { source: body.source, sourceId: body.sourceId, vendorOrgId: body.vendorOrgId },
    });

    if (body.source === 'incident') {
      await this.prisma.incident.update({
        where: { id: rec.id },
        data: { status: 'dispatched', workOrderId: wo.id },
      });
      await this.audit.transition({
        tenantId,
        actor: actorUserId,
        actorRole: 'manager',
        entityType: 'incident',
        entityId: rec.id,
        from: rec.status,
        to: 'dispatched',
        buildingId: rec.buildingId,
        metadata: { workOrderId: wo.id },
      });
    } else {
      await this.prisma.serviceRequest.update({
        where: { id: rec.id },
        data: { status: 'dispatched', workOrderId: wo.id },
      });
      await this.audit.transition({
        tenantId,
        actor: actorUserId,
        actorRole: 'manager',
        entityType: 'service_request',
        entityId: rec.id,
        from: rec.status,
        to: 'dispatched',
        buildingId: rec.buildingId,
        metadata: { workOrderId: wo.id },
      });
    }
    return wo;
  }

  // ─── Quote / PO / Completion ───────────────────────────────
  async createQuote(
    tenantId: string,
    actorUserId: string,
    body: {
      buildingIdOrSlug: string;
      workOrderId?: string;
      vendorOrgId?: string;
      title: string;
      description?: string;
      amount: number;
      currency?: string;
      validUntil?: string;
      revisionOf?: string;
      documentId?: string;
    },
  ) {
    if (!body.title || body.amount === undefined)
      throw new BadRequestException('title, amount required');
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
        tenantId,
        buildingId,
        workOrderId: body.workOrderId || null,
        vendorOrgId: body.vendorOrgId || null,
        requesterUserId: actorUserId,
        title: body.title,
        description: body.description || null,
        amount: body.amount,
        currency: body.currency || 'ILS',
        validUntil: body.validUntil ? new Date(body.validUntil) : null,
        status: 'received',
        revisionOf: body.revisionOf || null,
        documentId: body.documentId || null,
        receivedAt: new Date(),
      },
    });
  }

  async issuePurchaseOrder(
    tenantId: string,
    actorUserId: string,
    body: {
      quoteId?: string;
      workOrderId?: string;
      buildingIdOrSlug: string;
      poNumber?: string;
      vendorOrgId?: string;
      budgetLineId?: string;
      amount: number;
      currency?: string;
      expectedDeliveryAt?: string;
      capexOpex?: 'capex' | 'opex';
      notes?: string;
    },
  ) {
    if (body.amount === undefined) throw new BadRequestException('amount required');
    const buildingId = await this.resolveBuildingId(tenantId, body.buildingIdOrSlug);
    await this.assertManager(tenantId, actorUserId, buildingId);

    let quote = null as any;
    if (body.quoteId) {
      quote = await this.prisma.quote.findFirst({ where: { id: body.quoteId, tenantId } });
      if (!quote) throw new BadRequestException('quote not found');
      if (quote.status !== 'approved')
        throw new BadRequestException('quote must be approved before issuing PO');
      // SoD: PO issuer must not be the quote requester.
      if (quote.requesterUserId === actorUserId) {
        throw new ForbiddenException(
          'separation_of_duties: quote requester cannot issue the PO for their own quote',
        );
      }
    }

    const poNumber = body.poNumber || `PO-${Date.now()}`;
    const po = await this.prisma.purchaseOrder.create({
      data: {
        tenantId,
        buildingId,
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
      await this.prisma.quote.update({
        where: { id: quote.id },
        data: { approvalRequestId: quote.approvalRequestId || null },
      });
    }
    return po;
  }

  async recordCompletion(
    tenantId: string,
    actorUserId: string,
    body: {
      buildingIdOrSlug: string;
      workOrderId?: string;
      taskInstanceId?: string;
      completedAt?: string;
      labourHours?: number;
      labourCost?: number;
      materialsCost?: number;
      downtimeMinutes?: number;
      serviceReportDocumentId?: string;
      photoDocumentIds?: string[];
      notes?: string;
    },
  ) {
    const buildingId = await this.resolveBuildingId(tenantId, body.buildingIdOrSlug);
    await this.assertManager(tenantId, actorUserId, buildingId);

    // Hard-stop: if linked WO has an associated PO and no evidence, block.
    if (body.workOrderId) {
      const po = await this.prisma.purchaseOrder.findFirst({
        where: { workOrderId: body.workOrderId, status: { in: ['issued', 'in_progress'] } },
      });
      const hasEvidence =
        !!body.serviceReportDocumentId ||
        (body.photoDocumentIds && body.photoDocumentIds.length > 0);
      if (po && !hasEvidence) {
        throw new BadRequestException(
          'external work with PO cannot be closed without completion documents',
        );
      }
    }

    return this.prisma.completionRecord.create({
      data: {
        tenantId,
        buildingId,
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
    const filterStatus =
      params.status && params.status !== 'open' ? [params.status] : openIncidentStatuses;

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
          status: {
            in: params.status && params.status !== 'open' ? [params.status] : openSrStatuses,
          },
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
        id: i.id,
        title: i.title,
        description: i.description,
        severity: i.severity,
        priority: null,
        category: i.origin,
        status: i.status,
        buildingId: i.buildingId,
        buildingName: b?.name || null,
        buildingSlug: b?.slug || null,
        floorId: i.floorId || null,
        reportedAt: i.reportedAt.toISOString(),
        reportedBy: i.reportedBy,
        ackedAt: i.ackedAt ? i.ackedAt.toISOString() : null,
        ackDueAt: ackDueAt.toISOString(),
        resolveDueAt: resolveDueAt.toISOString(),
        ageMinutes: Math.round((now - openedAt) / 60000),
        ackBreached: !i.ackedAt && now > ackDueAt.getTime(),
        slaBreached: now > resolveDueAt.getTime(),
        assignedUserId: i.assignedUserId || null,
        assignmentSource: i.assignmentSource || null,
        assignmentReason: i.assignmentReason || null,
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
        id: r.id,
        title: r.category,
        description: r.description,
        severity: null,
        priority: r.priority,
        category: r.category,
        status: r.status,
        buildingId: r.buildingId,
        buildingName: b?.name || null,
        buildingSlug: b?.slug || null,
        floorId: r.floorId || null,
        reportedAt: r.createdAt.toISOString(),
        reportedBy: r.submittedBy,
        ackedAt: null,
        ackDueAt: ackDueAt.toISOString(),
        resolveDueAt: resolveDueAt.toISOString(),
        ageMinutes: Math.round((now - openedAt) / 60000),
        ackBreached: now > ackDueAt.getTime(),
        slaBreached: now > resolveDueAt.getTime(),
        assignedUserId: r.assignedUserId || null,
        assignmentSource: r.assignmentSource || null,
        assignmentReason: r.assignmentReason || null,
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
        dueSoon: items.filter(
          (i) => !i.slaBreached && new Date(i.resolveDueAt).getTime() - now < 4 * 3600000,
        ).length,
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
