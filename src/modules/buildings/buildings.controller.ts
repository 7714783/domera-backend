import { Body, Controller, Get, Headers, Param, Patch, Post, UnauthorizedException } from '@nestjs/common';
import { resolveTenantId } from '../../common/tenant.utils';
import { AuthService } from '../auth/auth.service';
import { BuildingsService } from './buildings.service';

async function extractUserId(auth: string | undefined, authService: AuthService): Promise<string> {
  if (!auth || !auth.startsWith('Bearer ')) throw new UnauthorizedException('no token');
  const payload = await authService.verifySession(auth.slice(7));
  if (!payload) throw new UnauthorizedException('invalid or revoked token');
  return payload.sub;
}

@Controller('buildings')
export class BuildingsController {
  constructor(
    private readonly buildings: BuildingsService,
    private readonly auth: AuthService,
  ) {}

  @Get()
  async list(@Headers('x-tenant-id') tenantIdHeader?: string) {
    const tenantId = resolveTenantId(tenantIdHeader);
    const items = await this.buildings.list(tenantId);
    return { tenantId, total: items.length, items };
  }

  @Get(':idOrSlug')
  async getOne(@Param('idOrSlug') idOrSlug: string, @Headers('x-tenant-id') tenantIdHeader?: string) {
    const tenantId = resolveTenantId(tenantIdHeader);
    return this.buildings.getOne(tenantId, idOrSlug);
  }

  @Post()
  async create(
    @Body() body: any,
    @Headers('x-tenant-id') tenantIdHeader?: string,
    @Headers('authorization') authHeader?: string,
  ) {
    const tenantId = resolveTenantId(tenantIdHeader);
    const userId = await extractUserId(authHeader, this.auth);
    return this.buildings.create(tenantId, userId, body);
  }

  @Patch(':slug')
  async patch(
    @Param('slug') slug: string,
    @Body() body: any,
    @Headers('x-tenant-id') tenantIdHeader?: string,
    @Headers('authorization') authHeader?: string,
  ) {
    const tenantId = resolveTenantId(tenantIdHeader);
    const userId = await extractUserId(authHeader, this.auth);
    return this.buildings.update(tenantId, userId, slug, body);
  }
}
