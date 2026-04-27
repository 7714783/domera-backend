import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

/**
 * Mobile-facing task lifecycle. Every mutation is a single-column update on
 * the existing TaskInstance row — no new tables, no migration. Tenant
 * isolation is enforced by PrismaService $extends auto-wrap (RLS policies
 * still filter every read/write).
 *
 * Status domain:
 *   open → in_progress → (paused ↔ in_progress) → completed
 *                      → cancelled
 *
 * INIT-002 Phase 5 P1 — add-note endpoint is deferred to a follow-up (needs
 * a separate TaskNote model + migration).
 */
@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // INIT-009 — Unified Tasks Inbox.
  //
  // Returns every task assigned to `actorUserId` regardless of source
  // module. Read-only union — no model merge. Each item carries a `kind`
  // discriminator + a `sourceUrl` so the frontend can route the user back
  // to the canonical module page for state changes.
  //
  // Sources unioned:
  //   1. PPM TaskInstance — tasks.assigned via building_role_assignment
  //      OR ppm_plan_items.assignedUserId. v1 keeps the simple version:
  //      filter by performerOrgId-style match isn't trivial, so we
  //      approximate by listing every TaskInstance in buildings the user
  //      has a role in. The mobile-friendly TasksController.list endpoint
  //      uses building scope; this inbox does the same and lets the UI
  //      show all tasks for the user's buildings.
  //   2. CleaningRequest — assignedStaffId.userId === actorUserId, or
  //      where the request is unassigned and the user is a cleaning_staff
  //      in the same building.
  //   3. Incident + ServiceRequest — assignedUserId === actorUserId.
  //
  // No new permissions: each leg respects its own module's RLS + tenant
  // filter. The aggregation is plain UNION + sort.
  async inbox(
    tenantId: string,
    actorUserId: string,
    opts: { kind?: 'ppm' | 'cleaning' | 'incident' | 'service_request' | 'all' } = {},
  ) {
    const wantPpm = !opts.kind || opts.kind === 'all' || opts.kind === 'ppm';
    const wantCleaning = !opts.kind || opts.kind === 'all' || opts.kind === 'cleaning';
    const wantIncident = !opts.kind || opts.kind === 'all' || opts.kind === 'incident';
    const wantSr = !opts.kind || opts.kind === 'all' || opts.kind === 'service_request';

    // Resolve building slugs once — we need them for sourceUrl.
    const buildings = await this.prisma.building.findMany({
      where: { tenantId },
      select: { id: true, slug: true, name: true },
    });
    const slugById = new Map(buildings.map((b) => [b.id, b.slug]));
    const nameById = new Map(buildings.map((b) => [b.id, b.name]));

    // Buildings where the user holds any role — bound the PPM scan to those.
    const grants = await this.prisma.buildingRoleAssignment.findMany({
      where: {
        tenantId,
        userId: actorUserId,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      select: { buildingId: true },
    });
    const userBuildings = [...new Set(grants.map((g) => g.buildingId))];

    // For cleaning we need to resolve CleaningStaff rows that map to this
    // user (via the optional CleaningStaff.userId bridge). assignedStaffId
    // on the request points at the CleaningStaff row, not the User — so
    // we pre-resolve the staffIds and then OR them into the query.
    const cleaningStaffIds = wantCleaning
      ? (
          await this.prisma.cleaningStaff.findMany({
            where: { tenantId, userId: actorUserId },
            select: { id: true },
          })
        ).map((s) => s.id)
      : [];

    const [ppmRows, cleaningRows, incidentRows, srRows] = await Promise.all([
      wantPpm && userBuildings.length > 0
        ? this.prisma.taskInstance.findMany({
            where: {
              tenantId,
              buildingId: { in: userBuildings },
              status: { in: ['open', 'in_progress', 'paused'] },
            },
            orderBy: [{ dueAt: 'asc' }],
            take: 100,
            select: {
              id: true,
              tenantId: true,
              buildingId: true,
              title: true,
              status: true,
              lifecycleStage: true,
              dueAt: true,
            },
          })
        : Promise.resolve([] as any[]),
      wantCleaning
        ? this.prisma.cleaningRequest.findMany({
            where: {
              tenantId,
              status: { in: ['new', 'assigned', 'in_progress'] },
              OR: [
                { assignedUserId: actorUserId },
                ...(cleaningStaffIds.length
                  ? [{ assignedStaffId: { in: cleaningStaffIds } }]
                  : []),
              ],
            },
            orderBy: [{ priority: 'desc' }, { requestedAt: 'asc' }],
            take: 100,
            select: {
              id: true,
              tenantId: true,
              buildingId: true,
              title: true,
              status: true,
              priority: true,
              category: true,
              dueAt: true,
              requestedAt: true,
            },
          })
        : Promise.resolve([] as any[]),
      wantIncident
        ? this.prisma.incident.findMany({
            where: {
              tenantId,
              assignedUserId: actorUserId,
              status: { in: ['new', 'triaged', 'dispatched'] },
            },
            orderBy: [{ severity: 'asc' }, { reportedAt: 'asc' }],
            take: 100,
            select: {
              id: true,
              tenantId: true,
              buildingId: true,
              title: true,
              status: true,
              severity: true,
              reportedAt: true,
            },
          })
        : Promise.resolve([] as any[]),
      wantSr
        ? this.prisma.serviceRequest.findMany({
            where: {
              tenantId,
              assignedUserId: actorUserId,
              status: { in: ['new', 'triaged', 'dispatched'] },
            },
            orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
            take: 100,
            select: {
              id: true,
              tenantId: true,
              buildingId: true,
              category: true,
              status: true,
              priority: true,
              createdAt: true,
            },
          })
        : Promise.resolve([] as any[]),
    ]);

    function makeUrl(kind: string, buildingId: string, id: string) {
      const slug = slugById.get(buildingId) || buildingId;
      switch (kind) {
        case 'ppm':
          return `/buildings/${slug}/ppm`;
        case 'cleaning':
          return `/buildings/${slug}/cleaning`;
        case 'incident':
        case 'service_request':
          return `/triage`;
        default:
          return `/buildings/${slug}/core`;
      }
    }

    const items: Array<{
      kind: 'ppm' | 'cleaning' | 'incident' | 'service_request';
      id: string;
      title: string;
      status: string;
      priority: string | null;
      dueAt: string | null;
      buildingId: string;
      buildingSlug: string | null;
      buildingName: string | null;
      sourceUrl: string;
    }> = [];

    for (const t of ppmRows) {
      items.push({
        kind: 'ppm',
        id: t.id,
        title: t.title,
        status: t.status,
        priority: null,
        dueAt: t.dueAt ? t.dueAt.toISOString() : null,
        buildingId: t.buildingId,
        buildingSlug: slugById.get(t.buildingId) || null,
        buildingName: nameById.get(t.buildingId) || null,
        sourceUrl: makeUrl('ppm', t.buildingId, t.id),
      });
    }
    for (const c of cleaningRows) {
      items.push({
        kind: 'cleaning',
        id: c.id,
        title: c.title || c.category,
        status: c.status,
        priority: c.priority,
        dueAt: c.dueAt ? c.dueAt.toISOString() : null,
        buildingId: c.buildingId,
        buildingSlug: slugById.get(c.buildingId) || null,
        buildingName: nameById.get(c.buildingId) || null,
        sourceUrl: makeUrl('cleaning', c.buildingId, c.id),
      });
    }
    for (const i of incidentRows) {
      items.push({
        kind: 'incident',
        id: i.id,
        title: i.title,
        status: i.status,
        priority: i.severity,
        dueAt: null,
        buildingId: i.buildingId,
        buildingSlug: slugById.get(i.buildingId) || null,
        buildingName: nameById.get(i.buildingId) || null,
        sourceUrl: makeUrl('incident', i.buildingId, i.id),
      });
    }
    for (const r of srRows) {
      items.push({
        kind: 'service_request',
        id: r.id,
        title: r.category,
        status: r.status,
        priority: r.priority,
        dueAt: null,
        buildingId: r.buildingId,
        buildingSlug: slugById.get(r.buildingId) || null,
        buildingName: nameById.get(r.buildingId) || null,
        sourceUrl: makeUrl('service_request', r.buildingId, r.id),
      });
    }

    // Stable order: open + in_progress + new bubble up; dueAt asc within
    // group; ties broken by kind alphabetical for visual stability.
    const STATUS_RANK: Record<string, number> = {
      in_progress: 0,
      assigned: 1,
      open: 2,
      new: 3,
      triaged: 4,
      dispatched: 5,
      paused: 6,
    };
    items.sort((a, b) => {
      const ra = STATUS_RANK[a.status] ?? 99;
      const rb = STATUS_RANK[b.status] ?? 99;
      if (ra !== rb) return ra - rb;
      const da = a.dueAt ? new Date(a.dueAt).getTime() : Number.POSITIVE_INFINITY;
      const db = b.dueAt ? new Date(b.dueAt).getTime() : Number.POSITIVE_INFINITY;
      if (da !== db) return da - db;
      return a.kind.localeCompare(b.kind);
    });

    const counts = {
      ppm: ppmRows.length,
      cleaning: cleaningRows.length,
      incident: incidentRows.length,
      service_request: srRows.length,
      total: items.length,
    };

    return { counts, items };
  }

  async list(
    tenantId: string,
    opts: { assignee?: 'me'; status?: string; buildingId?: string; limit?: number },
    actorUserId: string,
  ) {
    // `assignee=me` filters by performer-org membership OR assigned user in
    // future; for now it narrows to tasks whose building_role_assignments
    // include the caller. For v1 simplicity we only honour buildingId +
    // status filters — the mobile client always passes at least buildingId.
    const where: any = { tenantId };
    if (opts.buildingId) where.buildingId = opts.buildingId;
    if (opts.status) where.status = opts.status;
    const items = await this.prisma.taskInstance.findMany({
      where,
      orderBy: { dueAt: 'asc' },
      take: Math.min(opts.limit ?? 100, 200),
      select: {
        id: true,
        title: true,
        status: true,
        lifecycleStage: true,
        dueAt: true,
        completedAt: true,
        buildingId: true,
        planItemId: true,
        evidenceRequired: true,
      },
    });
    // Caller id is recorded so callers who are not members of the tenant are
    // already filtered out by tenant-middleware; this arg exists so future
    // assignee-filter work has the signature in place.
    void actorUserId;
    return { total: items.length, items };
  }

  async get(tenantId: string, id: string) {
    const t = await this.prisma.taskInstance.findFirst({ where: { id, tenantId } });
    if (!t) throw new NotFoundException('task not found');
    return t;
  }

  private async transition(
    tenantId: string,
    id: string,
    actorUserId: string,
    nextStatus: 'in_progress' | 'paused' | 'completed' | 'cancelled',
    allowedFrom: readonly string[],
    extra: Record<string, any> = {},
  ) {
    const task = await this.prisma.taskInstance.findFirst({
      where: { id, tenantId },
      include: { building: { select: { name: true } } },
    });
    if (!task) throw new NotFoundException('task not found');
    if (!allowedFrom.includes(task.status)) {
      throw new ForbiddenException(
        `cannot transition from ${task.status} to ${nextStatus} (allowed from: ${allowedFrom.join(', ')})`,
      );
    }
    const updated = await this.prisma.taskInstance.update({
      where: { id: task.id },
      data: { status: nextStatus, ...extra },
    });
    await this.audit.write({
      tenantId,
      buildingId: task.buildingId,
      actor: actorUserId,
      role: 'member',
      action: `Task ${nextStatus}`,
      entity: task.title,
      entityType: 'task',
      building: task.building?.name ?? '',
      ip: '0.0.0.0',
      sensitive: false,
      eventType: `task.${nextStatus}`,
      resourceType: 'task',
      resourceId: updated.id,
    });
    return updated;
  }

  start(tenantId: string, id: string, actor: string) {
    return this.transition(tenantId, id, actor, 'in_progress', ['open', 'paused'], {
      lifecycleStage: 'started',
    });
  }

  pause(tenantId: string, id: string, actor: string) {
    return this.transition(tenantId, id, actor, 'paused', ['in_progress'], {
      lifecycleStage: 'paused',
    });
  }

  resume(tenantId: string, id: string, actor: string) {
    return this.transition(tenantId, id, actor, 'in_progress', ['paused'], {
      lifecycleStage: 'started',
    });
  }

  async complete(
    tenantId: string,
    id: string,
    actor: string,
    body?: { result?: string; evidenceDocuments?: any[] },
  ) {
    const task = await this.prisma.taskInstance.findFirst({ where: { id, tenantId } });
    if (!task) throw new NotFoundException('task not found');
    if (
      task.evidenceRequired &&
      (!body?.evidenceDocuments || body.evidenceDocuments.length === 0)
    ) {
      throw new BadRequestException('evidence required');
    }
    return this.transition(tenantId, id, actor, 'completed', ['open', 'in_progress', 'paused'], {
      lifecycleStage: 'completed',
      completedAt: new Date(),
      completedByUserId: actor,
      result: body?.result ?? 'passed',
      evidenceDocuments: body?.evidenceDocuments ?? task.evidenceDocuments ?? [],
    });
  }

  // INIT-002 Phase 5 P1 — short on-site notes attached to a task. The mobile
  // technician posts updates ("part replaced", "customer not home"), the web
  // manager reads them in the task detail. No threading, no mentions.
  async addNote(
    tenantId: string,
    taskId: string,
    actorUserId: string,
    body: { body?: string },
  ) {
    const text = body?.body?.trim();
    if (!text) throw new BadRequestException('body required');
    if (text.length > 4000) throw new BadRequestException('body must be <= 4000 chars');
    const task = await this.prisma.taskInstance.findFirst({ where: { id: taskId, tenantId } });
    if (!task) throw new NotFoundException('task not found');
    return this.prisma.taskNote.create({
      data: {
        tenantId,
        taskInstanceId: task.id,
        authorUserId: actorUserId,
        body: text,
      },
    });
  }

  async listNotes(tenantId: string, taskId: string) {
    const task = await this.prisma.taskInstance.findFirst({ where: { id: taskId, tenantId } });
    if (!task) throw new NotFoundException('task not found');
    const notes = await this.prisma.taskNote.findMany({
      where: { taskInstanceId: task.id, tenantId },
      orderBy: { createdAt: 'asc' },
    });
    return { total: notes.length, items: notes };
  }
}
