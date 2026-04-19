import { Controller, Get, Headers, Param, UnauthorizedException } from '@nestjs/common';
import { resolveTenantId } from '../../common/tenant.utils';
import { AuthService } from '../auth/auth.service';
import { RoleDashboardsService } from './role-dashboards.service';

async function uid(auth: string | undefined, s: AuthService): Promise<string> {
  if (!auth || !auth.startsWith('Bearer ')) throw new UnauthorizedException('no token');
  const p = await s.verifySession(auth.slice(7));
  if (!p) throw new UnauthorizedException('invalid or revoked token');
  return p.sub;
}

@Controller('role-dashboards')
export class RoleDashboardsController {
  constructor(
    private readonly svc: RoleDashboardsService,
    private readonly auth: AuthService,
  ) {}

  @Get('building-manager/:building')
  buildingManager(@Param('building') id: string, @Headers('x-tenant-id') th?: string) {
    return this.svc.buildingManagerToday(resolveTenantId(th), id);
  }

  @Get('technician')
  async technicianAll(@Headers('x-tenant-id') th?: string, @Headers('authorization') ah?: string) {
    return this.svc.technicianQueue(resolveTenantId(th), await uid(ah, this.auth));
  }

  @Get('technician/:building')
  async technicianScoped(
    @Param('building') id: string,
    @Headers('x-tenant-id') th?: string, @Headers('authorization') ah?: string,
  ) {
    return this.svc.technicianQueue(resolveTenantId(th), await uid(ah, this.auth), id);
  }

  @Get('fm-director')
  fmDirector(@Headers('x-tenant-id') th?: string) {
    return this.svc.fmDirectorPortfolio(resolveTenantId(th));
  }

  @Get('tenant-representative')
  async tenantRepresentative(
    @Headers('x-tenant-id') th?: string,
    @Headers('authorization') ah?: string,
  ) {
    return this.svc.tenantRepresentativeSelfService(resolveTenantId(th), await uid(ah, this.auth));
  }
}
