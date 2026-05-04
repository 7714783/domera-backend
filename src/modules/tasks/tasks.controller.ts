import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { resolveTenantId } from '../../common/tenant.utils';
import { AuthService } from '../auth/auth.service';
import { TasksService } from './tasks.service';

async function uid(auth: string | undefined, s: AuthService): Promise<string> {
  if (!auth || !auth.startsWith('Bearer ')) throw new UnauthorizedException('no token');
  const p = await s.verifySession(auth.slice(7));
  if (!p) throw new UnauthorizedException('invalid or revoked token');
  return p.sub;
}

/**
 * Mobile-facing production task lifecycle routes. Distinct from the
 * /v1/seed-runtime/tasks/:id/complete dev helper — these are the paths
 * EAS builds will hit.
 */
@Controller('tasks')
export class TasksController {
  constructor(
    private readonly tasks: TasksService,
    private readonly auth: AuthService,
  ) {}

  @Get()
  async list(
    @Query('buildingId') buildingId?: string,
    @Query('status') status?: string,
    @Query('assignee') assignee?: string,
    @Query('limit') limit?: string,
    @Headers('x-tenant-id') tenantIdHeader?: string,
    @Headers('authorization') authHeader?: string,
  ) {
    const tenantId = resolveTenantId(tenantIdHeader);
    const actor = await uid(authHeader, this.auth);
    return this.tasks.list(
      tenantId,
      {
        buildingId,
        status,
        assignee: assignee === 'me' ? 'me' : undefined,
        limit: limit ? Number(limit) : undefined,
      },
      actor,
    );
  }

  // INIT-009 — Unified Tasks Inbox.
  // GET /v1/tasks/inbox?kind=ppm|cleaning|incident|service_request|all
  // Returns the union of every task assigned to the caller across
  // PPM / cleaning / reactive. Read-only union — state changes still
  // happen on each module's canonical endpoints (item.sourceUrl points
  // there).
  @Get('inbox')
  async inbox(
    @Query('kind') kind?: string,
    @Query('buildingId') buildingId?: string,
    @Query('take') take?: string,
    @Query('cursor') cursor?: string,
    @Headers('x-tenant-id') tenantIdHeader?: string,
    @Headers('authorization') authHeader?: string,
  ) {
    const tenantId = resolveTenantId(tenantIdHeader);
    const actor = await uid(authHeader, this.auth);
    const allowed = ['ppm', 'cleaning', 'incident', 'service_request', 'all'] as const;
    const k = (allowed as readonly string[]).includes(kind || '')
      ? (kind as (typeof allowed)[number])
      : 'all';
    const takeN = take ? Math.min(Math.max(parseInt(take, 10) || 50, 1), 200) : undefined;
    return this.tasks.inbox(tenantId, actor, {
      kind: k,
      buildingId: buildingId || undefined,
      take: takeN,
      cursor: cursor || undefined,
    });
  }

  @Get(':id')
  async get(
    @Param('id') id: string,
    @Headers('x-tenant-id') tenantIdHeader?: string,
    @Headers('authorization') authHeader?: string,
  ) {
    const tenantId = resolveTenantId(tenantIdHeader);
    await uid(authHeader, this.auth);
    return this.tasks.get(tenantId, id);
  }

  @Post(':id/start')
  async start(
    @Param('id') id: string,
    @Headers('x-tenant-id') tenantIdHeader?: string,
    @Headers('authorization') authHeader?: string,
  ) {
    const tenantId = resolveTenantId(tenantIdHeader);
    const actor = await uid(authHeader, this.auth);
    return this.tasks.start(tenantId, id, actor);
  }

  @Post(':id/pause')
  async pause(
    @Param('id') id: string,
    @Headers('x-tenant-id') tenantIdHeader?: string,
    @Headers('authorization') authHeader?: string,
  ) {
    const tenantId = resolveTenantId(tenantIdHeader);
    const actor = await uid(authHeader, this.auth);
    return this.tasks.pause(tenantId, id, actor);
  }

  @Post(':id/resume')
  async resume(
    @Param('id') id: string,
    @Headers('x-tenant-id') tenantIdHeader?: string,
    @Headers('authorization') authHeader?: string,
  ) {
    const tenantId = resolveTenantId(tenantIdHeader);
    const actor = await uid(authHeader, this.auth);
    return this.tasks.resume(tenantId, id, actor);
  }

  @Post(':id/complete')
  async complete(
    @Param('id') id: string,
    @Body() body: { result?: string; evidenceDocuments?: any[] },
    @Headers('x-tenant-id') tenantIdHeader?: string,
    @Headers('authorization') authHeader?: string,
  ) {
    const tenantId = resolveTenantId(tenantIdHeader);
    const actor = await uid(authHeader, this.auth);
    return this.tasks.complete(tenantId, id, actor, body);
  }

  // INIT-012 P1 chiller canary — second slice. Inspector marks
  // check_failed + requests vendor expense. Publishes
  // ppm.expense.requested; reactive subscriber spawns WorkOrder linked
  // to this task; approvals subscriber creates the ApprovalRequest.
  @Post(':id/request-expense')
  async requestExpense(
    @Param('id') id: string,
    @Body()
    body: {
      amount: number;
      currency?: string;
      reason: string;
      vendorOrgId?: string | null;
    },
    @Headers('x-tenant-id') tenantIdHeader?: string,
    @Headers('authorization') authHeader?: string,
  ) {
    const tenantId = resolveTenantId(tenantIdHeader);
    const actor = await uid(authHeader, this.auth);
    return this.tasks.requestExpense(tenantId, id, actor, body);
  }

  // INIT-002 Phase 5 P1 — short on-site notes attached to a task.
  @Get(':id/notes')
  async listNotes(
    @Param('id') id: string,
    @Headers('x-tenant-id') tenantIdHeader?: string,
    @Headers('authorization') authHeader?: string,
  ) {
    const tenantId = resolveTenantId(tenantIdHeader);
    await uid(authHeader, this.auth);
    return this.tasks.listNotes(tenantId, id);
  }

  @Post(':id/notes')
  async addNote(
    @Param('id') id: string,
    @Body() body: { body?: string },
    @Headers('x-tenant-id') tenantIdHeader?: string,
    @Headers('authorization') authHeader?: string,
  ) {
    const tenantId = resolveTenantId(tenantIdHeader);
    const actor = await uid(authHeader, this.auth);
    return this.tasks.addNote(tenantId, id, actor, body);
  }
}
