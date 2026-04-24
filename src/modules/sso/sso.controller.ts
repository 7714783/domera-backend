import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Post,
  Query,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { Response } from 'express';
import { resolveTenantId } from '../../common/tenant.utils';
import { AuthService } from '../auth/auth.service';
import { SsoService } from './sso.service';

async function uid(auth: string | undefined, s: AuthService): Promise<string> {
  if (!auth || !auth.startsWith('Bearer ')) throw new UnauthorizedException('no token');
  const p = await s.verifySession(auth.slice(7));
  if (!p) throw new UnauthorizedException('invalid or revoked token');
  return p.sub;
}

@Controller('sso')
export class SsoController {
  constructor(
    private readonly svc: SsoService,
    private readonly auth: AuthService,
  ) {}

  @Get('providers')
  listProviders(@Headers('x-tenant-id') th?: string) {
    return this.svc.listProviders(resolveTenantId(th));
  }

  @Post('providers')
  async upsertProvider(
    @Body() body: any,
    @Headers('x-tenant-id') th?: string,
    @Headers('authorization') ah?: string,
  ) {
    return this.svc.upsertProvider(resolveTenantId(th), await uid(ah, this.auth), body);
  }

  @Get('login/:providerKey')
  async login(
    @Res() res: Response,
    @Query('redirectTo') redirectTo: string = '/',
    @Headers('x-tenant-id') th?: string,
    @Headers('x-forwarded-host') _host?: string,
    @Headers('host') _fallback?: string,
  ) {
    const tenantId = resolveTenantId(th);
    const providerKey = (res.req.params as any).providerKey;
    const base = `${process.env.API_URL || 'http://localhost:4000'}`;
    const { authorizeUrl } = await this.svc.buildAuthorizeUrl(
      tenantId,
      providerKey,
      redirectTo,
      base,
    );
    return res.redirect(302, authorizeUrl);
  }

  @Get('callback')
  async callback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') errorParam: string | undefined,
    @Res() res: Response,
    @Headers('x-tenant-id') th?: string,
  ) {
    if (errorParam) throw new BadRequestException(`provider error: ${errorParam}`);
    if (!code || !state) throw new BadRequestException('code and state required');
    const tenantId = resolveTenantId(th);
    const redirectUri = `${process.env.API_URL || 'http://localhost:4000'}/v1/sso/callback`;
    const result = await this.svc.handleCallback(code, state, redirectUri, tenantId);
    const target = new URL(result.redirectTo, process.env.APP_URL || 'http://localhost:3000');
    target.searchParams.set('sso_token', result.token);
    return res.redirect(302, target.toString());
  }

  @Post('callback/exchange')
  async exchange(
    @Body() body: { code: string; state: string },
    @Headers('x-tenant-id') th?: string,
  ) {
    const tenantId = resolveTenantId(th);
    const redirectUri = `${process.env.API_URL || 'http://localhost:4000'}/v1/sso/callback`;
    return this.svc.handleCallback(body.code, body.state, redirectUri, tenantId);
  }
}
