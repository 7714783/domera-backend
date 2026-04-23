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
      { buildingId, status, assignee: assignee === 'me' ? 'me' : undefined, limit: limit ? Number(limit) : undefined },
      actor,
    );
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
}
