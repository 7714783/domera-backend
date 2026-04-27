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
  ContractorsWorkspaceService,
  type WorkspaceContractorCreate,
  type WorkspaceContractorUpdate,
} from './contractors-workspace.service';

async function uid(auth: string | undefined, s: AuthService): Promise<string> {
  if (!auth || !auth.startsWith('Bearer ')) throw new UnauthorizedException('no token');
  const p = await s.verifySession(auth.slice(7));
  if (!p) throw new UnauthorizedException('invalid or revoked token');
  return p.sub;
}

@Controller('workspace-contractors')
export class ContractorsWorkspaceController {
  constructor(
    private readonly svc: ContractorsWorkspaceService,
    private readonly auth: AuthService,
  ) {}

  @Get()
  async list(
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Headers('x-tenant-id') tenantIdHeader?: string,
    @Headers('authorization') authHeader?: string,
  ) {
    const tenantId = resolveTenantId(tenantIdHeader);
    await uid(authHeader, this.auth);
    return this.svc.list(tenantId, { status, search });
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
    @Body() body: WorkspaceContractorCreate,
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
    @Body() body: WorkspaceContractorUpdate,
    @Headers('x-tenant-id') tenantIdHeader?: string,
    @Headers('authorization') authHeader?: string,
  ) {
    const tenantId = resolveTenantId(tenantIdHeader);
    const actor = await uid(authHeader, this.auth);
    return this.svc.update(tenantId, actor, id, body);
  }

  @Delete(':id')
  async unlink(
    @Param('id') id: string,
    @Headers('x-tenant-id') tenantIdHeader?: string,
    @Headers('authorization') authHeader?: string,
  ) {
    const tenantId = resolveTenantId(tenantIdHeader);
    const actor = await uid(authHeader, this.auth);
    return this.svc.unlink(tenantId, actor, id);
  }
}
