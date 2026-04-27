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
  RoleAssignmentsService,
  type AssignmentCreate,
  type AssignmentUpdate,
} from './role-assignments.service';

async function uid(auth: string | undefined, s: AuthService): Promise<string> {
  if (!auth || !auth.startsWith('Bearer ')) throw new UnauthorizedException('no token');
  const p = await s.verifySession(auth.slice(7));
  if (!p) throw new UnauthorizedException('invalid or revoked token');
  return p.sub;
}

@Controller('role-assignments')
export class RoleAssignmentsController {
  constructor(
    private readonly svc: RoleAssignmentsService,
    private readonly auth: AuthService,
  ) {}

  @Get()
  async list(
    @Query('teamMemberId') teamMemberId?: string,
    @Query('roleKey') roleKey?: string,
    @Query('activeOnly') activeOnly?: string,
    @Headers('x-tenant-id') tenantIdHeader?: string,
    @Headers('authorization') authHeader?: string,
  ) {
    const tenantId = resolveTenantId(tenantIdHeader);
    await uid(authHeader, this.auth);
    return this.svc.list(tenantId, {
      teamMemberId,
      roleKey,
      activeOnly: activeOnly !== '0' && activeOnly !== 'false',
    });
  }

  @Post()
  async create(
    @Body() body: AssignmentCreate,
    @Headers('x-tenant-id') tenantIdHeader?: string,
    @Headers('authorization') authHeader?: string,
  ) {
    const tenantId = resolveTenantId(tenantIdHeader);
    const actor = await uid(authHeader, this.auth);
    return this.svc.assign(tenantId, actor, body);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() body: AssignmentUpdate,
    @Headers('x-tenant-id') tenantIdHeader?: string,
    @Headers('authorization') authHeader?: string,
  ) {
    const tenantId = resolveTenantId(tenantIdHeader);
    const actor = await uid(authHeader, this.auth);
    return this.svc.update(tenantId, actor, id, body);
  }

  @Delete(':id')
  async remove(
    @Param('id') id: string,
    @Headers('x-tenant-id') tenantIdHeader?: string,
    @Headers('authorization') authHeader?: string,
  ) {
    const tenantId = resolveTenantId(tenantIdHeader);
    const actor = await uid(authHeader, this.auth);
    return this.svc.revoke(tenantId, actor, id);
  }
}
