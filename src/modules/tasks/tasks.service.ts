import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OutboxService } from '../events/outbox.service';

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
    private readonly outbox: OutboxService,
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
    opts: {
      kind?: 'ppm' | 'cleaning' | 'incident' | 'service_request' | 'all';
      buildingId?: string;
      take?: number;
      cursor?: string;
    } = {},
  ) {
    const wantPpm = !opts.kind || opts.kind === 'all' || opts.kind === 'ppm';
    const wantCleaning = !opts.kind || opts.kind === 'all' || opts.kind === 'cleaning';
    const wantIncident = !opts.kind || opts.kind === 'all' || opts.kind === 'incident';
    const wantSr = !opts.kind || opts.kind === 'all' || opts.kind === 'service_request';

    // PERF-001 Stage 2 — single RLS transaction for the whole batch.
    // Pre-refactor this method opened 7 separate transactions
    // (one per prisma call), each with its own set_config(). Now: 1.
    // Cursor pagination is per-leg — each kind keeps its own
    // chronological order; the merged feed is sorted in memory.
    const PER_LEG_TAKE = Math.min(Math.max(opts.take ?? 50, 1), 200);
    const buildingFilter = opts.buildingId ? { buildingId: opts.buildingId } : {};

    // Cursor format: "<kind>:<isoTimestamp>" — one per leg can be passed
    // through as a comma-joined string. v1 keeps it simple: the cursor
    // is just an absolute "items older than this" cutoff applied to
    // every leg's primary timestamp (dueAt for ppm/cleaning, reportedAt
    // for incidents, createdAt for SRs).
    const cursorDate = opts.cursor ? new Date(opts.cursor) : null;
    const cursorClause = cursorDate && !isNaN(cursorDate.getTime()) ? cursorDate : null;

    const { buildings, ppmRows, cleaningRows, incidentRows, srRows } = await this.prisma.withTenant(
      tenantId,
      async (tx) => {
        // Resolve building slugs + role grants in parallel-on-pipeline
        // (Prisma serialises within an interactive transaction, but the
        // round-trip cost is paid once because they share the same
        // connection + set_config).
        const buildings = await tx.building.findMany({
          where: { tenantId, ...(opts.buildingId ? { id: opts.buildingId } : {}) },
          select: { id: true, slug: true, name: true },
        });
        const grants = await tx.buildingRoleAssignment.findMany({
          where: {
            tenantId,
            userId: actorUserId,
            OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
          },
          select: { buildingId: true },
        });
        const userBuildings = [...new Set(grants.map((g) => g.buildingId))];
        const userBuildingFilter = opts.buildingId
          ? userBuildings.includes(opts.buildingId)
            ? [opts.buildingId]
            : []
          : userBuildings;

        const cleaningStaffIds = wantCleaning
          ? (
              await tx.cleaningStaff.findMany({
                where: { tenantId, userId: actorUserId },
                select: { id: true },
              })
            ).map((s) => s.id)
          : [];

        const ppmRows =
          wantPpm && userBuildingFilter.length > 0
            ? await tx.taskInstance.findMany({
                where: {
                  tenantId,
                  buildingId: { in: userBuildingFilter },
                  status: { in: ['open', 'in_progress', 'paused'] },
                  ...(cursorClause ? { dueAt: { lt: cursorClause } } : {}),
                },
                orderBy: [{ dueAt: 'asc' }],
                take: PER_LEG_TAKE,
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
            : ([] as any[]);

        const cleaningRows = wantCleaning
          ? await tx.cleaningRequest.findMany({
              where: {
                tenantId,
                status: { in: ['new', 'assigned', 'in_progress'] },
                OR: [
                  { assignedUserId: actorUserId },
                  ...(cleaningStaffIds.length
                    ? [{ assignedStaffId: { in: cleaningStaffIds } }]
                    : []),
                ],
                ...buildingFilter,
                ...(cursorClause ? { requestedAt: { lt: cursorClause } } : {}),
              },
              orderBy: [{ priority: 'desc' }, { requestedAt: 'asc' }],
              take: PER_LEG_TAKE,
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
          : ([] as any[]);

        const incidentRows = wantIncident
          ? await tx.incident.findMany({
              where: {
                tenantId,
                assignedUserId: actorUserId,
                status: { in: ['new', 'triaged', 'dispatched'] },
                ...buildingFilter,
                ...(cursorClause ? { reportedAt: { lt: cursorClause } } : {}),
              },
              orderBy: [{ severity: 'asc' }, { reportedAt: 'asc' }],
              take: PER_LEG_TAKE,
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
          : ([] as any[]);

        const srRows = wantSr
          ? await tx.serviceRequest.findMany({
              where: {
                tenantId,
                assignedUserId: actorUserId,
                status: { in: ['new', 'triaged', 'dispatched'] },
                ...buildingFilter,
                ...(cursorClause ? { createdAt: { lt: cursorClause } } : {}),
              },
              orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
              take: PER_LEG_TAKE,
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
          : ([] as any[]);

        return { buildings, ppmRows, cleaningRows, incidentRows, srRows };
      },
      'tasks.inbox',
    );

    const slugById = new Map(buildings.map((b) => [b.id, b.slug]));
    const nameById = new Map(buildings.map((b) => [b.id, b.name]));

    function makeUrl(kind: string, buildingId: string) {
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
        sourceUrl: makeUrl('ppm', t.buildingId),
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
        sourceUrl: makeUrl('cleaning', c.buildingId),
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
        sourceUrl: makeUrl('incident', i.buildingId),
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
        sourceUrl: makeUrl('service_request', r.buildingId),
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
    // INIT-012 P1 chiller canary — publish ppm.case.closed when a task
    // (canonical PPM case carrier) completes, so subscribers (assets
    // module updates the maintenance timeline; notifications dispatches
    // closeout email; future reactive subscriber spawns invoice) can
    // react without direct cross-module writes.
    if (nextStatus === 'completed') {
      await this.outbox.publish(this.prisma, {
        type: 'ppm.case.closed',
        source: 'tasks',
        subject: updated.id,
        buildingId: updated.buildingId,
        payload: {
          tenantId,
          taskInstanceId: updated.id,
          buildingId: updated.buildingId,
          planItemId: updated.planItemId,
          assetId: (updated as any).assetId ?? null,
          completedAt: updated.completedAt,
          completedByUserId: actorUserId,
          result: updated.result,
        },
      });
    }
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

  // INIT-012 P1 chiller canary — second slice. Inspector marked the
  // task `check_failed` and needs vendor expense. We stamp the quote
  // fields on the TaskInstance and publish `ppm.expense.requested` so
  // both the approvals module (decides) and the reactive module
  // (spawns WorkOrder linked to this task) can react. This is a
  // separate transition: the task itself stays in `in_progress` until
  // the vendor returns and the operator runs `complete()` with the
  // service-report evidence.
  async requestExpense(
    tenantId: string,
    id: string,
    actorUserId: string,
    body: {
      amount: number;
      currency?: string;
      reason: string;
      vendorOrgId?: string | null;
    },
  ) {
    if (!body || typeof body.amount !== 'number' || body.amount <= 0) {
      throw new BadRequestException('amount required (> 0)');
    }
    if (!body.reason || body.reason.trim().length === 0) {
      throw new BadRequestException('reason required');
    }
    const task = await this.prisma.taskInstance.findFirst({
      where: { id, tenantId },
      include: { building: { select: { name: true } } },
    });
    if (!task) throw new NotFoundException('task not found');
    if (task.status === 'completed' || task.status === 'cancelled') {
      throw new ForbiddenException(`cannot request expense on ${task.status} task`);
    }
    const currency = body.currency || task.quoteCurrency || 'ILS';
    const updated = await this.prisma.taskInstance.update({
      where: { id: task.id },
      data: {
        result: 'check_failed',
        quoteAmount: body.amount,
        quoteCurrency: currency,
        quoteReceivedAt: new Date(),
      },
    });
    await this.audit.write({
      tenantId,
      buildingId: task.buildingId,
      actor: actorUserId,
      role: 'member',
      action: 'task.expense_requested',
      entity: task.title,
      entityType: 'task',
      building: task.building?.name ?? '',
      ip: '0.0.0.0',
      sensitive: true,
      eventType: 'ppm.expense.requested',
      resourceType: 'task',
      resourceId: updated.id,
    });
    await this.outbox.publish(this.prisma, {
      type: 'ppm.expense.requested',
      source: 'tasks',
      subject: updated.id,
      buildingId: updated.buildingId,
      payload: {
        tenantId,
        caseId: updated.id,
        buildingId: updated.buildingId,
        amount: body.amount,
        currency,
        reason: body.reason,
        vendorOrgId: body.vendorOrgId ?? null,
      },
    });
    return updated;
  }

  // INIT-002 Phase 5 P1 — short on-site notes attached to a task. The mobile
  // technician posts updates ("part replaced", "customer not home"), the web
  // manager reads them in the task detail. No threading, no mentions.
  async addNote(tenantId: string, taskId: string, actorUserId: string, body: { body?: string }) {
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

  // ─── Mobile contract alignment (P0) ─────────────────────────────────
  //
  // Mobile clients call /v1/tasks/:id/{timeline, transition, comments}.
  // These three were missing from the backend (apps/mobile/docs/
  // api-integration.md flagged them; mobile build compiled but runtime
  // would 404 on first tap). Pinned by tasks-mobile-contract.test.mjs.

  // GET /v1/tasks/:id/timeline — read-only feed assembled from the
  // canonical audit trail. Returns AuditEntry rows scoped to
  // (entityType='taskInstance', entity=:id) shaped to TaskTimelineEntry
  // per apps/mobile/src/modules/tasks/types.ts.
  async timeline(tenantId: string, taskId: string) {
    const task = await this.prisma.taskInstance.findFirst({ where: { id: taskId, tenantId } });
    if (!task) throw new NotFoundException('task not found');
    const entries = await this.prisma.auditEntry.findMany({
      where: { tenantId, entityType: 'taskInstance', entity: taskId },
      orderBy: { timestamp: 'asc' },
      take: 200,
      select: {
        id: true,
        eventType: true,
        action: true,
        actor: true,
        timestamp: true,
        metadata: true,
      },
    });
    return entries.map((e) => {
      // Mobile expects `message` to be a free-text human summary; we
      // synthesise it from metadata.{reason,note,result} or fall back
      // to action. Audit metadata is jsonb so we narrow defensively.
      const meta = (e.metadata as Record<string, unknown> | null) || {};
      const message =
        (typeof meta.reason === 'string' && meta.reason) ||
        (typeof meta.note === 'string' && meta.note) ||
        (typeof meta.result === 'string' && meta.result) ||
        null;
      return {
        id: e.id,
        eventType: e.eventType || e.action,
        actor: e.actor,
        createdAt: e.timestamp.toISOString(),
        message,
      };
    });
  }

  // POST /v1/tasks/:id/transition — wraps the existing state-machine
  // ops (start / pause / resume / complete) under a single mobile-
  // friendly endpoint. The body's `toStatus` names the target state;
  // we route to the matching method. No new transitions are
  // introduced — the contract is "express the same machine, fewer
  // routes". An unknown toStatus is a 400; an illegal source→target
  // pair surfaces as the underlying method's error.
  //
  // Method name is `applyTransition` (not `transition`) because
  // `transition` is already taken by the private state-machine
  // helper that start/pause/resume/complete share.
  async applyTransition(
    tenantId: string,
    taskId: string,
    actorUserId: string,
    body: { toStatus?: string; comment?: string },
  ) {
    const toStatus = (body?.toStatus || '').trim();
    if (!toStatus) throw new BadRequestException('toStatus required');

    // Optional comment lands as a TaskNote BEFORE the transition fires
    // — keeps the timeline ordered "operator said X" then "system did
    // Y" rather than the other way around. Note is only persisted when
    // non-empty after trim.
    const comment = body?.comment?.trim();
    if (comment && comment.length > 0) {
      await this.addNote(tenantId, taskId, actorUserId, { body: comment });
    }

    switch (toStatus) {
      case 'in_progress': {
        // Single ambiguous client verb → server-side disambiguation. // We pick by current status: paused → resume, anything-else → start. // Mobile uses one verb for both fresh-start and resume-from-paused.
        const task = await this.prisma.taskInstance.findFirst({
          where: { id: taskId, tenantId },
          select: { status: true },
        });
        if (!task) throw new NotFoundException('task not found');
        if (task.status === 'paused') return this.resume(tenantId, taskId, actorUserId);
        return this.start(tenantId, taskId, actorUserId);
      }
      case 'paused':
        return this.pause(tenantId, taskId, actorUserId);
      case 'completed':
        return this.complete(tenantId, taskId, actorUserId, {});
      default:
        throw new BadRequestException(
          `unsupported toStatus '${toStatus}' — allowed: in_progress | paused | completed`,
        );
    }
  }

  // POST /v1/tasks/:id/comments — thin alias over addNote for the
  // mobile shape `{ message }` → returns TaskComment shape
  // `{ id, actor, message, createdAt }`. The underlying TaskNote
  // model + RLS + length cap stay the same.
  async addComment(
    tenantId: string,
    taskId: string,
    actorUserId: string,
    body: { message?: string },
  ) {
    const note = await this.addNote(tenantId, taskId, actorUserId, { body: body?.message });
    return {
      id: note.id,
      actor: note.authorUserId,
      message: note.body,
      createdAt: note.createdAt.toISOString(),
    };
  }
}
