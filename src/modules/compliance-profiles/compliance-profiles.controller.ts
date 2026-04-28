import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { resolveTenantId } from '../../common/tenant.utils';
import { AuthService } from '../auth/auth.service';
import { ComplianceProfilesService } from './compliance-profiles.service';

async function uid(auth: string | undefined, s: AuthService): Promise<string> {
  if (!auth || !auth.startsWith('Bearer ')) throw new UnauthorizedException('no token');
  const p = await s.verifySession(auth.slice(7));
  if (!p) throw new UnauthorizedException('invalid or revoked token');
  return p.sub;
}

@Controller()
export class ComplianceProfilesController {
  constructor(
    private readonly svc: ComplianceProfilesService,
    private readonly auth: AuthService,
  ) {}

  @Get('compliance-profiles')
  list(@Headers('x-tenant-id') th?: string) {
    return this.svc.list(resolveTenantId(th));
  }

  @Post('compliance-profiles')
  upsert(@Body() body: any, @Headers('x-tenant-id') th?: string) {
    return this.svc.createOrUpdate(resolveTenantId(th), body);
  }

  @Post('compliance-profiles/seed-built-ins')
  seedBuiltIns(@Headers('x-tenant-id') th?: string) {
    return this.svc.seedBuiltIns(resolveTenantId(th));
  }

  @Get('buildings/:id/compliance-profiles')
  forBuilding(@Param('id') id: string, @Headers('x-tenant-id') th?: string) {
    return this.svc.forBuilding(resolveTenantId(th), id);
  }

  @Post('buildings/:id/compliance-profiles/:key')
  async assign(
    @Param('id') id: string,
    @Param('key') key: string,
    @Headers('x-tenant-id') th?: string,
    @Headers('authorization') ah?: string,
  ) {
    return this.svc.assignToBuilding(resolveTenantId(th), id, key, await uid(ah, this.auth));
  }

  @Delete('buildings/:id/compliance-profiles/:key')
  unassign(
    @Param('id') id: string,
    @Param('key') key: string,
    @Headers('x-tenant-id') th?: string,
  ) {
    return this.svc.unassignFromBuilding(resolveTenantId(th), id, key);
  }
}
