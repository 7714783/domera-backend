// GROWTH-001 NS-24 — scanner REST surface.
//
// POST /v1/scanner/resolve { token } -> typed scan target.
//
// Authenticated (tenant-scoped) — the resolver uses tenantId to
// filter rows, so anonymous access could enumerate cross-tenant
// codes by trying every prefix. Per-IP rate-limited regardless.

import {
  Body,
  Controller,
  Headers,
  HttpException,
  HttpStatus,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { resolveTenantId } from '../../common/tenant.utils';
import { rateLimit } from '../../common/rate-limit';
import { AuthService } from '../auth/auth.service';
import { ScannerService } from './scanner.service';

const RESOLVE_WINDOW_MS = 60_000;
const RESOLVE_MAX = 60; // 1/sec sustained per IP — generous for live scanning

function clientIp(req: any): string {
  return (req?.ip || req?.connection?.remoteAddress || 'unknown').toString();
}

async function uid(auth: string | undefined, s: AuthService): Promise<string> {
  if (!auth || !auth.startsWith('Bearer ')) throw new UnauthorizedException('no token');
  const p = await s.verifySession(auth.slice(7));
  if (!p) throw new UnauthorizedException('invalid or revoked token');
  return p.sub;
}

@Controller('scanner')
export class ScannerController {
  constructor(
    private readonly svc: ScannerService,
    private readonly auth: AuthService,
  ) {}

  @Post('resolve')
  async resolve(
    @Body() body: { token?: string },
    @Headers('x-tenant-id') tenantIdHeader?: string,
    @Headers('authorization') authHeader?: string,
    @Req() req?: any,
  ) {
    const ip = clientIp(req);
    const rl = rateLimit({
      key: `scanner:resolve:${ip}`,
      windowMs: RESOLVE_WINDOW_MS,
      max: RESOLVE_MAX,
    });
    if (!rl.allowed) {
      throw new HttpException(
        { error: 'rate limited', retryAfterMs: rl.retryAfterMs },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const tenantId = resolveTenantId(tenantIdHeader);
    await uid(authHeader, this.auth);
    return this.svc.resolve(tenantId, body?.token || '');
  }
}
