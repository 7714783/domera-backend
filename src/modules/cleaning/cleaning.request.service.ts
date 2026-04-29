import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MigratorPrismaService } from '../../prisma/prisma.migrator';
import { ActorResolver } from '../../common/authz';
import { AuditService } from '../audit/audit.service';
import { CleaningActor, canAssign, canChangeStatus, filterForActor } from './cleaning.access';

const VALID_PRIORITIES = ['low', 'normal', 'high', 'urgent'];
const VALID_CATEGORIES = [
  'regular_cleaning',
  'urgent_cleaning',
  'spill',
  'restroom_issue',
  'trash_overflow',
  'other',
];
const VALID_SOURCES = ['dashboard', 'qr', 'admin', 'dispatcher'];
const TERMINAL = new Set(['done', 'rejected', 'cancelled']);

function sanitizeText(s: string | undefined | null, maxLen = 2000): string | null {
  if (!s) return null;
  return s
    .trim()
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .slice(0, maxLen);
}

@Injectable()
export class CleaningRequestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly migrator: MigratorPrismaService,
    private readonly actorResolver: ActorResolver,
    private readonly audit: AuditService,
  ) {}

  async list(
    actor: CleaningActor,
    params: {
      status?: string;
      priority?: string;
      contractorId?: string;
      zoneId?: string;
      source?: string;
      buildingId?: string;
      take?: number;
      skip?: number;
    },
  ) {
    const where: any = { ...filterForActor(actor) };
    if (params.status) where.status = params.status;
    if (params.priority) where.priority = params.priority;
    if (params.source) where.source = params.source;
    if (params.buildingId && !where.buildingId) where.buildingId = params.buildingId;
    if (params.buildingId && typeof where.buildingId === 'object') {
      // Respect actor scope when user filters by buildingId
      const list = (where.buildingId as any).in as string[] | undefined;
      if (list && !list.includes(params.buildingId))
        throw new ForbiddenException('building out of scope');
      where.buildingId = params.buildingId;
    }
    if (params.contractorId) {
      const cur = where.contractorId;
      if (cur && typeof cur === 'string' && cur !== params.contractorId)
        throw new ForbiddenException('contractor out of scope');
      if (cur && typeof cur === 'object' && !(cur.in as string[]).includes(params.contractorId))
        throw new ForbiddenException('contractor out of scope');
      where.contractorId = params.contractorId;
    }
    if (params.zoneId) where.zoneId = params.zoneId;

    // INIT-007 Phase 4 — narrow by tenantCompany / created-by-self if the
    // actor's role demands it. tasks.view_all bypasses tasks.view_company.
    // Skip for platform_admin (already returns full base scope).
    if (actor.kind !== 'platform_admin' && actor.userId) {
      const a = await this.actorResolver.resolve({
        tenantId: actor.tenantId,
        userId: actor.userId,
      });
      if (!a.isSuperAdmin) {
        const seesAll = a.permissions.has('tasks.view_all');
        if (!seesAll && a.scope.tenantCompanyId && a.permissions.has('tasks.view_company')) {
          where.tenantCompanyId = a.scope.tenantCompanyId;
        }
        if (a.scope.createdByScope === true) {
          where.createdByUserId = actor.userId;
        }
      }
    }

    const take = Math.min(Math.max(params.take || 50, 1), 200);
    const skip = Math.max(params.skip || 0, 0);
    const [items, total] = await Promise.all([
      this.prisma.cleaningRequest.findMany({
        where,
        take,
        skip,
        orderBy: [{ requestedAt: 'desc' }],
      }),
      this.prisma.cleaningRequest.count({ where }),
    ]);
    return { total, items };
  }

  async get(actor: CleaningActor, id: string) {
    const req = await this.prisma.cleaningRequest.findFirst({
      where: { id, ...filterForActor(actor) } as any,
    });
    if (!req) throw new NotFoundException('request not found');
    const [comments, history, attachments, zone] = await Promise.all([
      this.prisma.cleaningRequestComment.findMany({
        where: { requestId: id },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.cleaningRequestHistory.findMany({
        where: { requestId: id },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.cleaningRequestAttachment.findMany({
        where: { requestId: id },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.cleaningZone.findUnique({ where: { id: req.zoneId } }),
    ]);
    return { ...req, zone, comments, history, attachments };
  }

  // Internal create (dashboard / admin) — actor-scoped.
  async internalCreate(
    actor: CleaningActor,
    body: {
      buildingId: string;
      zoneId: string;
      title: string;
      description?: string;
      category: string;
      priority?: string;
      source?: string;
      contractorId?: string;
      assignedStaffId?: string;
      dueAt?: string;
    },
  ) {
    this.validateCreateBody(body);
    const zone = await this.prisma.cleaningZone.findFirst({
      where: { id: body.zoneId, tenantId: actor.tenantId, buildingId: body.buildingId },
    });
    if (!zone) throw new NotFoundException('zone not found');

    const { contractorId, assignedStaffId, status, assignedAt } = await this.computeAssignment({
      tenantId: actor.tenantId,
      zone,
      overrideContractorId: body.contractorId,
      overrideStaffId: body.assignedStaffId,
    });

    const created = await this.prisma.cleaningRequest.create({
      data: {
        tenantId: actor.tenantId,
        buildingId: body.buildingId,
        zoneId: body.zoneId,
        title: sanitizeText(body.title, 200)!,
        description: sanitizeText(body.description),
        category: body.category,
        priority: body.priority || 'normal',
        source: body.source || 'dashboard',
        createdByUserId: actor.userId,
        contractorId: contractorId || null,
        assignedStaffId: assignedStaffId || null,
        status,
        assignedAt: assignedAt || null,
        dueAt: body.dueAt ? new Date(body.dueAt) : null,
      },
    });
    await this.logHistory(actor.tenantId, created.id, 'created', 'user', actor.userId, {
      source: created.source,
      contractorId,
      assignedStaffId,
      status,
    });
    return created;
  }

  // Public create (via QR) — no actor; relies on the QR resolver for scope.
  // Uses the migrator client because the public HTTP path has no tenant
  // context and the app role is NOBYPASSRLS + FORCE RLS.
  async publicCreate(body: {
    tenantId: string;
    buildingId: string;
    zoneId: string;
    qrPointId?: string;
    title: string;
    description?: string;
    category: string;
    priority?: string;
    guestName?: string;
    guestPhone?: string;
  }) {
    this.validateCreateBody(body);
    const zone = await this.migrator.cleaningZone.findFirst({
      where: { id: body.zoneId, tenantId: body.tenantId, buildingId: body.buildingId },
    });
    if (!zone) throw new NotFoundException('zone not found');

    const { contractorId, assignedStaffId, status, assignedAt } = await this.computeAssignment(
      { tenantId: body.tenantId, zone },
      this.migrator,
    );

    const created = await this.migrator.cleaningRequest.create({
      data: {
        tenantId: body.tenantId,
        buildingId: body.buildingId,
        zoneId: body.zoneId,
        qrPointId: body.qrPointId || null,
        title: sanitizeText(body.title, 200)!,
        description: sanitizeText(body.description),
        category: body.category,
        priority: body.priority || 'normal',
        source: 'qr',
        createdByGuestName: sanitizeText(body.guestName, 100),
        createdByGuestPhone: sanitizeText(body.guestPhone, 50),
        contractorId: contractorId || null,
        assignedStaffId: assignedStaffId || null,
        status,
        assignedAt: assignedAt || null,
      },
    });
    await this.logHistoryOn(this.migrator, body.tenantId, created.id, 'created', 'guest', null, {
      source: 'qr',
      contractorId,
      assignedStaffId,
      status,
    });
    // Return a minimal object — never leak internal ids to the public caller.
    return {
      ok: true,
      reference: created.id.slice(0, 8),
      status: created.status,
      zone: { name: zone.name, code: zone.code, zoneType: zone.zoneType },
      requestedAt: created.requestedAt,
    };
  }

  async changeStatus(actor: CleaningActor, id: string, to: string) {
    const req = await this.prisma.cleaningRequest.findFirst({
      where: { id, ...filterForActor(actor) } as any,
    });
    if (!req) throw new NotFoundException('request not found');
    if (!canChangeStatus(actor, req.status, to)) {
      throw new ForbiddenException(`transition ${req.status}→${to} not allowed for ${actor.kind}`);
    }
    const now = new Date();
    const data: any = { status: to };
    if (to === 'in_progress' && !req.startedAt) data.startedAt = now;
    if (to === 'done' || to === 'rejected' || to === 'cancelled') data.resolvedAt = now;
    if (to === 'done') data.closedByUserId = actor.userId;
    if (to === 'assigned' && req.status === 'in_progress') {
      data.assignedStaffId = null;
      data.startedAt = null;
    }
    const updated = await this.prisma.cleaningRequest.update({ where: { id }, data });
    await this.logHistory(
      actor.tenantId,
      id,
      `status.${req.status}_to_${to}`,
      'user',
      actor.userId,
      {},
    );
    await this.audit.transition({
      tenantId: actor.tenantId,
      actor: actor.userId,
      actorRole: actor.kind,
      entityType: 'cleaning_request',
      entityId: id,
      from: req.status,
      to,
      buildingId: req.buildingId,
    });
    return updated;
  }

  async assign(
    actor: CleaningActor,
    id: string,
    body: { contractorId?: string; assignedStaffId?: string },
  ) {
    if (!canAssign(actor)) throw new ForbiddenException('cannot assign');
    const req = await this.prisma.cleaningRequest.findFirst({
      where: { id, ...filterForActor(actor) } as any,
    });
    if (!req) throw new NotFoundException('request not found');
    if (TERMINAL.has(req.status))
      throw new BadRequestException(`request is ${req.status}; cannot reassign`);

    let contractorId = body.contractorId ?? req.contractorId;
    const assignedStaffId = body.assignedStaffId ?? null;

    if (contractorId) {
      const c = await this.prisma.cleaningContractor.findFirst({
        where: { id: contractorId, tenantId: actor.tenantId },
      });
      if (!c) throw new NotFoundException('contractor not found');
    }
    if (assignedStaffId) {
      const s = await this.prisma.cleaningStaff.findFirst({
        where: { id: assignedStaffId, tenantId: actor.tenantId },
      });
      if (!s) throw new NotFoundException('staff not found');
      if (contractorId && s.contractorId !== contractorId) {
        throw new BadRequestException('staff does not belong to contractor');
      }
      contractorId = s.contractorId;
    }

    const newStatus = assignedStaffId ? 'assigned' : req.status === 'new' ? 'new' : req.status;
    const updated = await this.prisma.cleaningRequest.update({
      where: { id },
      data: {
        contractorId: contractorId || null,
        assignedStaffId: assignedStaffId || null,
        status: newStatus,
        assignedAt: assignedStaffId ? new Date() : req.assignedAt,
      },
    });
    await this.logHistory(actor.tenantId, id, 'assigned', 'user', actor.userId, {
      contractorId,
      assignedStaffId,
    });
    if (newStatus !== req.status) {
      await this.audit.transition({
        tenantId: actor.tenantId,
        actor: actor.userId,
        actorRole: actor.kind,
        entityType: 'cleaning_request',
        entityId: id,
        from: req.status,
        to: newStatus,
        buildingId: req.buildingId,
        metadata: { contractorId, assignedStaffId },
      });
    }
    return updated;
  }

  async addComment(actor: CleaningActor, id: string, body: { body: string; isInternal?: boolean }) {
    const req = await this.prisma.cleaningRequest.findFirst({
      where: { id, ...filterForActor(actor) } as any,
    });
    if (!req) throw new NotFoundException('request not found');
    const text = sanitizeText(body.body);
    if (!text || text.length < 1) throw new BadRequestException('body required');
    const c = await this.prisma.cleaningRequestComment.create({
      data: {
        tenantId: actor.tenantId,
        requestId: id,
        authorUserId: actor.userId,
        body: text,
        isInternal: !!body.isInternal,
      },
    });
    await this.logHistory(actor.tenantId, id, 'comment.added', 'user', actor.userId, {
      isInternal: !!body.isInternal,
    });
    return c;
  }

  // ── Helpers ────────────────────────────────────────────
  private validateCreateBody(body: {
    title?: string;
    category?: string;
    priority?: string;
    source?: string;
  }) {
    if (!body.title) throw new BadRequestException('title required');
    if (!body.category || !VALID_CATEGORIES.includes(body.category)) {
      throw new BadRequestException(`category must be one of ${VALID_CATEGORIES.join(', ')}`);
    }
    if (body.priority && !VALID_PRIORITIES.includes(body.priority))
      throw new BadRequestException('invalid priority');
    if (body.source && !VALID_SOURCES.includes(body.source))
      throw new BadRequestException('invalid source');
  }

  private async computeAssignment(
    params: {
      tenantId: string;
      zone: { contractorId: string | null; supervisorStaffId: string | null };
      overrideContractorId?: string;
      overrideStaffId?: string;
    },
    client: { cleaningStaff: { findUnique: (args: any) => Promise<any> } } = this.prisma as any,
  ) {
    let contractorId = params.overrideContractorId ?? params.zone.contractorId ?? null;
    let assignedStaffId = params.overrideStaffId ?? null;

    if (!assignedStaffId && params.zone.supervisorStaffId) {
      assignedStaffId = params.zone.supervisorStaffId;
    }
    if (assignedStaffId && !contractorId) {
      const s = await client.cleaningStaff.findUnique({ where: { id: assignedStaffId } });
      if (s) contractorId = s.contractorId;
    }
    const status = assignedStaffId ? 'assigned' : 'new';
    const assignedAt = assignedStaffId ? new Date() : null;
    return { contractorId, assignedStaffId, status, assignedAt };
  }

  private async logHistory(
    tenantId: string,
    requestId: string,
    action: string,
    actorType: string,
    actorId: string | null,
    payload: any,
  ) {
    await this.prisma.cleaningRequestHistory.create({
      data: {
        tenantId,
        requestId,
        action,
        actorType,
        actorId,
        payloadJson: payload as any,
      },
    });
  }

  private async logHistoryOn(
    client: any,
    tenantId: string,
    requestId: string,
    action: string,
    actorType: string,
    actorId: string | null,
    payload: any,
  ) {
    await client.cleaningRequestHistory.create({
      data: {
        tenantId,
        requestId,
        action,
        actorType,
        actorId,
        payloadJson: payload as any,
      },
    });
  }
}
