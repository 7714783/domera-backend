import { Body, Controller, Get, Headers, Param, Post, Query, UnauthorizedException } from '@nestjs/common';
import { resolveTenantId } from '../../common/tenant.utils';
import { AuthService } from '../auth/auth.service';
import { VendorInvoicesService } from './vendor-invoices.service';

async function uid(auth: string | undefined, s: AuthService): Promise<string> {
  if (!auth || !auth.startsWith('Bearer ')) throw new UnauthorizedException('no token');
  const p = await s.verifySession(auth.slice(7));
  if (!p) throw new UnauthorizedException('invalid or revoked token');
  return p.sub;
}

@Controller('vendor-invoices')
export class VendorInvoicesController {
  constructor(
    private readonly svc: VendorInvoicesService,
    private readonly auth: AuthService,
  ) {}

  @Get()
  list(
    @Query('buildingId') buildingId?: string,
    @Query('matchStatus') matchStatus?: string,
    @Headers('x-tenant-id') th?: string,
  ) {
    return this.svc.list(resolveTenantId(th), buildingId, matchStatus);
  }

  @Post()
  async create(
    @Body() body: any,
    @Headers('x-tenant-id') th?: string,
    @Headers('authorization') ah?: string,
  ) {
    return this.svc.create(resolveTenantId(th), await uid(ah, this.auth), body);
  }

  @Post(':id/match')
  async match(
    @Param('id') id: string,
    @Headers('x-tenant-id') th?: string,
    @Headers('authorization') ah?: string,
  ) {
    return this.svc.match(resolveTenantId(th), await uid(ah, this.auth), id);
  }

  @Post(':id/approve')
  async approve(
    @Param('id') id: string,
    @Headers('x-tenant-id') th?: string,
    @Headers('authorization') ah?: string,
  ) {
    return this.svc.approve(resolveTenantId(th), await uid(ah, this.auth), id);
  }
}
