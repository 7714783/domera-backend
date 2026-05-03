import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { resolveTenantId } from '../../common/tenant.utils';
import { AuthService } from '../auth/auth.service';
import {
  TeamService,
  type TeamMemberCreate,
  type TeamMemberKind,
  type TeamMemberUpdate,
} from './team.service';
import { RoleAssignmentsService } from '../role-assignments/role-assignments.service';

async function uid(auth: string | undefined, s: AuthService): Promise<string> {
  if (!auth || !auth.startsWith('Bearer ')) throw new UnauthorizedException('no token');
  const p = await s.verifySession(auth.slice(7));
  if (!p) throw new UnauthorizedException('invalid or revoked token');
  return p.sub;
}

@Controller('team')
export class TeamController {
  constructor(
    private readonly svc: TeamService,
    private readonly auth: AuthService,
    private readonly assignments: RoleAssignmentsService,
  ) {}

  // INIT-013 — eligible-assignees endpoint. Used by PPM / Cleaning /
  // Reactive UI selectors AND by their server services for auto-routing.
  // Caller passes the permission required to handle the task plus the
  // task context (building / floor / zone / system); we return the list
  // of TeamMembers whose role-permission set covers the task and whose
  // ABAC scope intersects the context. Sorted least-loaded first when
  // openTaskLoad is provided.
  @Get('eligible')
  async eligible(
    @Query('permission') permission: string,
    @Query('buildingId') buildingId?: string,
    @Query('floorId') floorId?: string,
    @Query('zoneId') zoneId?: string,
    @Query('systemId') systemId?: string,
    @Query('strategy') strategy?: string,
    @Headers('x-tenant-id') tenantIdHeader?: string,
    @Headers('authorization') authHeader?: string,
  ) {
    const tenantId = resolveTenantId(tenantIdHeader);
    await uid(authHeader, this.auth);
    if (!permission) return { items: [] };
    const items = await this.assignments.findEligibleAssignees(tenantId, {
      requiredPermission: permission,
      buildingId,
      floorId,
      zoneId,
      systemId,
      strategy:
        (strategy as 'first' | 'least_loaded' | 'round_robin' | undefined) ?? 'least_loaded',
    });
    return { total: items.length, items };
  }

  @Get()
  async list(
    @Query('search') search?: string,
    @Query('kind') kind?: string,
    @Query('activeOnly') activeOnly?: string,
    @Headers('x-tenant-id') tenantIdHeader?: string,
    @Headers('authorization') authHeader?: string,
  ) {
    const tenantId = resolveTenantId(tenantIdHeader);
    await uid(authHeader, this.auth);
    return this.svc.list(tenantId, {
      search,
      kind: kind as TeamMemberKind | undefined,
      activeOnly: activeOnly === '1' || activeOnly === 'true',
    });
  }

  @Get(':id')
  async getOne(
    @Param('id') id: string,
    @Headers('x-tenant-id') tenantIdHeader?: string,
    @Headers('authorization') authHeader?: string,
  ) {
    const tenantId = resolveTenantId(tenantIdHeader);
    await uid(authHeader, this.auth);
    return this.svc.getOne(tenantId, id);
  }

  @Post()
  async create(
    @Body() body: TeamMemberCreate,
    @Headers('x-tenant-id') tenantIdHeader?: string,
    @Headers('authorization') authHeader?: string,
  ) {
    const tenantId = resolveTenantId(tenantIdHeader);
    const actor = await uid(authHeader, this.auth);
    return this.svc.create(tenantId, actor, body);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() body: TeamMemberUpdate,
    @Headers('x-tenant-id') tenantIdHeader?: string,
    @Headers('authorization') authHeader?: string,
  ) {
    const tenantId = resolveTenantId(tenantIdHeader);
    const actor = await uid(authHeader, this.auth);
    return this.svc.update(tenantId, actor, id, body);
  }

  @Delete(':id')
  async deactivate(
    @Param('id') id: string,
    @Headers('x-tenant-id') tenantIdHeader?: string,
    @Headers('authorization') authHeader?: string,
  ) {
    const tenantId = resolveTenantId(tenantIdHeader);
    const actor = await uid(authHeader, this.auth);
    return this.svc.deactivate(tenantId, actor, id);
  }
}
