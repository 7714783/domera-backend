import { Body, Controller, Get, Headers, Param, Post, Query, UnauthorizedException } from '@nestjs/common';
import { resolveTenantId } from '../../common/tenant.utils';
import { AuthService } from '../auth/auth.service';
import { EmergencyOverridesService } from './emergency-overrides.service';

async function uid(auth: string | undefined, s: AuthService): Promise<string> {
  if (!auth || !auth.startsWith('Bearer ')) throw new UnauthorizedException('no token');
  const p = await s.verifySession(auth.slice(7));
  if (!p) throw new UnauthorizedException('invalid or revoked token');
  return p.sub;
}

@Controller('emergency-overrides')
export class EmergencyOverridesController {
  constructor(
    private readonly svc: EmergencyOverridesService,
    private readonly auth: AuthService,
  ) {}

  @Get()
  list(
    @Query('status') status?: string,
    @Query('buildingId') buildingId?: string,
    @Headers('x-tenant-id') th?: string,
  ) {
    return this.svc.list(resolveTenantId(th), { status, buildingId });
  }

  @Post()
  async invoke(
    @Body() body: any,
    @Headers('x-tenant-id') th?: string,
    @Headers('authorization') ah?: string,
  ) {
    return this.svc.invoke(resolveTenantId(th), await uid(ah, this.auth), body);
  }

  @Post(':id/ratify')
  async ratify(
    @Param('id') id: string,
    @Body() body: { decision: 'ratified' | 'rejected'; notes?: string },
    @Headers('x-tenant-id') th?: string,
    @Headers('authorization') ah?: string,
  ) {
    return this.svc.ratify(resolveTenantId(th), await uid(ah, this.auth), id, body.decision, body.notes);
  }

  @Post('mark-lapsed')
  markLapsed() {
    return this.svc.markLapsed();
  }
}
