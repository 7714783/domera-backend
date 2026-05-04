// GROWTH-001 NS-19 — invite REST surface.
//
// Routes:
//   POST   /v1/invites                  — manager-gated; creates a pending
//                                         invite + returns plaintext token once
//   GET    /v1/invites                  — manager-gated; list invites for tenant
//   POST   /v1/invites/:id/revoke       — manager-gated; flips status to 'revoked'
//   POST   /v1/invites/accept           — PUBLIC; consumes a token (rate-limited)
//
// /accept does NOT require a Bearer token — the invite token IS the authn
// material. Per-IP rate limit prevents brute-forcing the 32-byte token
// space. After accept, the invite.accepted outbox event drives the iam
// User + Membership creation.

import {
  Body,
  Controller,
  Get,
  Headers,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { resolveTenantId } from '../../common/tenant.utils';
import { rateLimit } from '../../common/rate-limit';
import { AuthService } from '../auth/auth.service';
import { InvitesService } from './invites.service';

const ACCEPT_WINDOW_MS = 60_000;
const ACCEPT_MAX = 10;

function clientIp(req: any): string {
  return (req?.ip || req?.connection?.remoteAddress || 'unknown').toString();
}

async function uid(auth: string | undefined, s: AuthService): Promise<string> {
  if (!auth || !auth.startsWith('Bearer ')) throw new UnauthorizedException('no token');
  const p = await s.verifySession(auth.slice(7));
  if (!p) throw new UnauthorizedException('invalid or revoked token');
  return p.sub;
}

@Controller('invites')
export class InvitesController {
  constructor(
    private readonly invites: InvitesService,
    private readonly auth: AuthService,
  ) {}

  @Post()
  async create(
    @Body() body: { email: string; roleKey: string; buildingIds?: string[] },
    @Headers('x-tenant-id') th?: string,
    @Headers('authorization') ah?: string,
  ) {
    return this.invites.create(resolveTenantId(th), await uid(ah, this.auth), body);
  }

  @Get()
  async list(
    @Query('status') status?: string,
    @Headers('x-tenant-id') th?: string,
    @Headers('authorization') ah?: string,
  ) {
    return this.invites.list(resolveTenantId(th), await uid(ah, this.auth), { status });
  }

  @Post(':id/revoke')
  async revoke(
    @Param('id') id: string,
    @Headers('x-tenant-id') th?: string,
    @Headers('authorization') ah?: string,
  ) {
    return this.invites.revoke(resolveTenantId(th), await uid(ah, this.auth), id);
  }

  // PUBLIC — no Bearer required. Token IS the authn.
  @Post('accept')
  async accept(
    @Body() body: { token: string; fullName?: string; password?: string },
    @Req() req: any,
  ) {
    const ip = clientIp(req);
    const rl = rateLimit({
      key: `invites:accept:${ip}`,
      windowMs: ACCEPT_WINDOW_MS,
      max: ACCEPT_MAX,
    });
    if (!rl.allowed) {
      throw new HttpException(
        { error: 'rate limited', retryAfterMs: rl.retryAfterMs },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return this.invites.accept(body?.token || '', body || {});
  }
}
