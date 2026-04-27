import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { resolveTenantId } from '../../common/tenant.utils';
import { AuthService } from '../auth/auth.service';
import { RolesService, type RoleCreate, type RoleUpdate } from './roles.service';

async function uid(auth: string | undefined, s: AuthService): Promise<string> {
  if (!auth || !auth.startsWith('Bearer ')) throw new UnauthorizedException('no token');
  const p = await s.verifySession(auth.slice(7));
  if (!p) throw new UnauthorizedException('invalid or revoked token');
  return p.sub;
}

@Controller('roles')
export class RolesController {
  constructor(
    private readonly svc: RolesService,
    private readonly auth: AuthService,
  ) {}

  @Get()
  async list(
    @Headers('x-tenant-id') tenantIdHeader?: string,
    @Headers('authorization') authHeader?: string,
  ) {
    const tenantId = resolveTenantId(tenantIdHeader);
    await uid(authHeader, this.auth);
    return this.svc.list(tenantId);
  }

  @Get(':key')
  async getOne(
    @Param('key') key: string,
    @Headers('x-tenant-id') tenantIdHeader?: string,
    @Headers('authorization') authHeader?: string,
  ) {
    const tenantId = resolveTenantId(tenantIdHeader);
    await uid(authHeader, this.auth);
    return this.svc.getOne(tenantId, key);
  }

  @Post()
  async create(
    @Body() body: RoleCreate,
    @Headers('x-tenant-id') tenantIdHeader?: string,
    @Headers('authorization') authHeader?: string,
  ) {
    const tenantId = resolveTenantId(tenantIdHeader);
    const actor = await uid(authHeader, this.auth);
    return this.svc.create(tenantId, actor, body);
  }

  @Post(':key/clone')
  async clone(
    @Param('key') sourceKey: string,
    @Body() body: { name: string },
    @Headers('x-tenant-id') tenantIdHeader?: string,
    @Headers('authorization') authHeader?: string,
  ) {
    const tenantId = resolveTenantId(tenantIdHeader);
    const actor = await uid(authHeader, this.auth);
    return this.svc.clone(tenantId, actor, sourceKey, body);
  }

  @Patch(':key')
  async update(
    @Param('key') key: string,
    @Body() body: RoleUpdate,
    @Headers('x-tenant-id') tenantIdHeader?: string,
    @Headers('authorization') authHeader?: string,
  ) {
    const tenantId = resolveTenantId(tenantIdHeader);
    const actor = await uid(authHeader, this.auth);
    return this.svc.update(tenantId, actor, key, body);
  }

  @Delete(':key')
  async remove(
    @Param('key') key: string,
    @Headers('x-tenant-id') tenantIdHeader?: string,
    @Headers('authorization') authHeader?: string,
  ) {
    const tenantId = resolveTenantId(tenantIdHeader);
    const actor = await uid(authHeader, this.auth);
    return this.svc.remove(tenantId, actor, key);
  }
}
