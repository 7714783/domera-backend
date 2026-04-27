import {
  Body,
  Controller,
  Get,
  Headers,
  HttpException,
  HttpStatus,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { rateLimit } from '../../common/rate-limit';

// INIT-008 Phase 3 (P1-004) — abuse mitigation on auth endpoints. Per-IP
// sliding window: 10 attempts / 60s for login, 5 / 60s for register.
// In-memory store; sufficient for single-node Railway deployment. Switch
// to Redis-backed when we scale out.
const LOGIN_WINDOW_MS = 60_000;
const LOGIN_MAX = 10;
const REGISTER_WINDOW_MS = 60_000;
const REGISTER_MAX = 5;

function clientIp(req: any): string {
  const xff = req.headers?.['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) return xff.split(',')[0].trim();
  return (req.ip || req.socket?.remoteAddress || 'unknown').toString();
}

function extractBearer(auth: string | undefined): string {
  if (!auth || !auth.startsWith('Bearer ')) throw new UnauthorizedException('no token');
  return auth.slice(7);
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  register(
    @Body() body: { username: string; password: string; email?: string; displayName?: string },
    @Req() req: any,
  ) {
    const ip = clientIp(req);
    const rl = rateLimit({
      key: `auth:register:${ip}`,
      windowMs: REGISTER_WINDOW_MS,
      max: REGISTER_MAX,
    });
    if (!rl.allowed) {
      throw new HttpException(
        { error: 'rate limited', retryAfterMs: rl.retryAfterMs },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return this.auth.register(body, {
      userAgent: req.headers?.['user-agent'],
      ipAddress: ip,
    });
  }

  @Post('login')
  login(@Body() body: { username?: string; email?: string; password: string }, @Req() req: any) {
    const ip = clientIp(req);
    const rl = rateLimit({ key: `auth:login:${ip}`, windowMs: LOGIN_WINDOW_MS, max: LOGIN_MAX });
    if (!rl.allowed) {
      throw new HttpException(
        { error: 'rate limited', retryAfterMs: rl.retryAfterMs },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return this.auth.login(body, {
      userAgent: req.headers?.['user-agent'],
      ipAddress: ip,
    });
  }

  @Get('me')
  async me(@Headers('authorization') auth?: string) {
    const token = extractBearer(auth);
    const payload = await this.auth.verifySession(token);
    if (!payload) throw new UnauthorizedException('invalid or revoked token');
    return this.auth.me(payload.sub);
  }

  @Get('sessions')
  async sessions(@Headers('authorization') auth?: string) {
    const token = extractBearer(auth);
    const payload = await this.auth.verifySession(token);
    if (!payload) throw new UnauthorizedException('invalid or revoked token');
    return this.auth.listSessions(payload.sub);
  }

  @Post('logout')
  async logout(@Headers('authorization') auth?: string) {
    const token = extractBearer(auth);
    const payload = await this.auth.verifySession(token);
    if (!payload) throw new UnauthorizedException('invalid or revoked token');
    return this.auth.logout(token, payload.sub);
  }

  @Post('logout-all')
  async logoutAll(@Headers('authorization') auth?: string) {
    const token = extractBearer(auth);
    const payload = await this.auth.verifySession(token);
    if (!payload) throw new UnauthorizedException('invalid or revoked token');
    return this.auth.logoutAll(payload.sub);
  }

  // INIT-013 — workspace switcher. Body: { tenantId }.
  // Returns a freshly minted token; the old one is revoked.
  @Post('switch-workspace')
  async switchWorkspace(
    @Body() body: { tenantId: string },
    @Headers('authorization') auth?: string,
    @Req() req?: any,
  ) {
    const token = extractBearer(auth);
    const payload = await this.auth.verifySession(token);
    if (!payload) throw new UnauthorizedException('invalid or revoked token');
    if (!body?.tenantId) throw new HttpException('tenantId required', HttpStatus.BAD_REQUEST);
    return this.auth.switchWorkspace(token, payload.sub, body.tenantId, {
      userAgent: req?.headers?.['user-agent'],
      ipAddress: clientIp(req),
    });
  }
}
