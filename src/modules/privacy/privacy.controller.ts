import { Body, Controller, Get, Headers, Param, Post, Query, UnauthorizedException } from '@nestjs/common';
import { resolveTenantId } from '../../common/tenant.utils';
import { AuthService } from '../auth/auth.service';
import { PrivacyService } from './privacy.service';

async function uid(auth: string | undefined, s: AuthService): Promise<string> {
  if (!auth || !auth.startsWith('Bearer ')) throw new UnauthorizedException('no token');
  const p = await s.verifySession(auth.slice(7));
  if (!p) throw new UnauthorizedException('invalid or revoked token');
  return p.sub;
}

@Controller('privacy')
export class PrivacyController {
  constructor(
    private readonly svc: PrivacyService,
    private readonly auth: AuthService,
  ) {}

  @Get('categories')
  listCategories(@Headers('x-tenant-id') th?: string) {
    return this.svc.listCategories(resolveTenantId(th));
  }

  @Post('categories')
  async upsertCategory(
    @Body() body: any,
    @Headers('x-tenant-id') th?: string, @Headers('authorization') ah?: string,
  ) {
    return this.svc.upsertCategory(resolveTenantId(th), await uid(ah, this.auth), body);
  }

  @Post('categories/seed-built-ins')
  async seedBuiltIns(
    @Headers('x-tenant-id') th?: string, @Headers('authorization') ah?: string,
  ) {
    return this.svc.seedBuiltIns(resolveTenantId(th), await uid(ah, this.auth));
  }

  @Get('ropa')
  ropa(@Headers('x-tenant-id') th?: string) {
    return this.svc.ropa(resolveTenantId(th));
  }

  // DSAR
  @Post('dsar')
  createDsar(@Body() body: any, @Headers('x-tenant-id') th?: string) {
    return this.svc.createDsar(resolveTenantId(th), body);
  }

  @Get('dsar')
  listDsar(@Query('status') status?: string, @Headers('x-tenant-id') th?: string) {
    return this.svc.listDsar(resolveTenantId(th), status);
  }

  @Post('dsar/:id/process')
  async processDsar(
    @Param('id') id: string,
    @Headers('x-tenant-id') th?: string, @Headers('authorization') ah?: string,
  ) {
    return this.svc.processDsar(resolveTenantId(th), await uid(ah, this.auth), id);
  }
}
