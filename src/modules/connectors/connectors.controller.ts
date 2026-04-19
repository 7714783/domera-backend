import { Body, Controller, Get, Headers, Post, Query, Req, Res, UnauthorizedException } from '@nestjs/common';
import type { Response } from 'express';
import { resolveTenantId } from '../../common/tenant.utils';
import { AuthService } from '../auth/auth.service';
import { ConnectorsService } from './connectors.service';

async function uid(auth: string | undefined, s: AuthService): Promise<string> {
  if (!auth || !auth.startsWith('Bearer ')) throw new UnauthorizedException('no token');
  const p = await s.verifySession(auth.slice(7));
  if (!p) throw new UnauthorizedException('invalid or revoked token');
  return p.sub;
}

@Controller('connectors')
export class ConnectorsController {
  constructor(
    private readonly svc: ConnectorsService,
    private readonly auth: AuthService,
  ) {}

  @Get()
  list() {
    return this.svc.list();
  }

  @Get('accounting/export.csv')
  async exportAccounting(
    @Res() res: Response,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('matchStatus') matchStatus?: string,
    @Query('approvedOnly') approvedOnly?: string,
    @Headers('x-tenant-id') th?: string,
  ) {
    const out = await this.svc.exportAccounting(resolveTenantId(th), {
      from, to, matchStatus,
      approvedOnly: approvedOnly === '1' || approvedOnly === 'true',
    });
    res.setHeader('Content-Type', out.mime);
    res.setHeader('Content-Disposition', `attachment; filename="${out.filename}"`);
    res.send(out.body);
  }

  @Post('vendor-master/import.csv')
  async importVendorMaster(
    @Req() req: any,
    @Headers('x-tenant-id') th?: string,
    @Headers('authorization') ah?: string,
  ) {
    const raw: Buffer = req.rawBody || Buffer.alloc(0);
    return this.svc.importVendorMaster(
      resolveTenantId(th), await uid(ah, this.auth),
      raw.toString('utf8'),
    );
  }
}
