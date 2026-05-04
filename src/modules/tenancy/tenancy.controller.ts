// GROWTH-001 NS-23 — operational REST surface for tenant emergencies.
//
// Routes (NOT under tenant middleware's normal flow — they target a
// foreign tenant by id; the actor's session is what proves authority):
//
//   POST /v1/admin/tenants/:id/suspend
//        body: { confirmText: <slug>, reason?: string }
//
//   POST /v1/admin/tenants/:id/reactivate
//        body: { confirmText: <slug>, reason?: string }
//
//   POST /v1/admin/tenants/:id/export
//        body: { confirmText: <slug> }
//        returns the full-tenant JSON dump as application/json with
//        Content-Disposition=attachment so a curl saves it to a file.
//
// All three are gated on workspace_owner membership (or superadmin)
// + verbatim-slug confirmation.

import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Param,
  Post,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { Response } from 'express';
import { AuthService } from '../auth/auth.service';
import { TenancyService } from './tenancy.service';

async function uid(auth: string | undefined, s: AuthService): Promise<string> {
  if (!auth || !auth.startsWith('Bearer ')) throw new UnauthorizedException('no token');
  const p = await s.verifySession(auth.slice(7));
  if (!p) throw new UnauthorizedException('invalid or revoked token');
  return p.sub;
}

@Controller('admin/tenants')
export class TenancyController {
  constructor(
    private readonly svc: TenancyService,
    private readonly auth: AuthService,
  ) {}

  @Post(':id/suspend')
  @HttpCode(200)
  async suspend(
    @Param('id') id: string,
    @Body() body: { confirmText?: string; reason?: string },
    @Headers('authorization') ah?: string,
  ) {
    return this.svc.suspend(await uid(ah, this.auth), id, body || {});
  }

  @Post(':id/reactivate')
  @HttpCode(200)
  async reactivate(
    @Param('id') id: string,
    @Body() body: { confirmText?: string; reason?: string },
    @Headers('authorization') ah?: string,
  ) {
    return this.svc.reactivate(await uid(ah, this.auth), id, body || {});
  }

  @Post(':id/export')
  @HttpCode(200)
  async export(
    @Param('id') id: string,
    @Body() body: { confirmText?: string },
    @Headers('authorization') ah?: string,
    @Res() res?: Response,
  ) {
    const dump = await this.svc.exportFull(await uid(ah, this.auth), id, body || {});
    const slug = (dump.tenant as any)?.slug || id;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    if (res) {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="domera-${slug}-${stamp}.json"`);
      res.send(JSON.stringify(dump, null, 2));
      return;
    }
    return dump;
  }
}
