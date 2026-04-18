import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { resolveTenantId } from '../../common/tenant.utils';
import { TakeoverService } from './takeover.service';

@Controller('takeover')
export class TakeoverController {
  constructor(private readonly takeover: TakeoverService) {}

  @Post('cases')
  async create(
    @Body() body: { buildingSlug: string; outgoingOrgSeedKey?: string; incomingOrgSeedKey?: string; targetGoLiveAt?: string },
    @Headers('x-tenant-id') tenantIdHeader?: string,
    @Headers('x-actor-user-id') actorHeader?: string,
  ) {
    const tenantId = resolveTenantId(tenantIdHeader);
    return this.takeover.createCase(tenantId, actorHeader || 'system', body);
  }

  @Get(':id/gap-analysis')
  async gap(@Param('id') id: string, @Headers('x-tenant-id') tenantIdHeader?: string) {
    const tenantId = resolveTenantId(tenantIdHeader);
    return this.takeover.gapAnalysis(tenantId, id);
  }

  @Post(':id/signoff')
  async signoff(
    @Param('id') id: string,
    @Headers('x-tenant-id') tenantIdHeader?: string,
    @Headers('x-actor-user-id') actorHeader?: string,
    @Headers('x-actor-role') actorRoleHeader?: string,
  ) {
    const tenantId = resolveTenantId(tenantIdHeader);
    return this.takeover.signoff(tenantId, id, actorHeader || 'system', actorRoleHeader || 'viewer');
  }
}
