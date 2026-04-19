import { Body, Controller, Get, Headers, Post, Req, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';

function extractBearer(auth: string | undefined): string {
  if (!auth || !auth.startsWith('Bearer ')) throw new UnauthorizedException('no token');
  return auth.slice(7);
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  register(@Body() body: { username: string; password: string; email?: string; displayName?: string }, @Req() req: any) {
    return this.auth.register(body, {
      userAgent: req.headers?.['user-agent'],
      ipAddress: req.ip || req.socket?.remoteAddress,
    });
  }

  @Post('login')
  login(@Body() body: { username: string; password: string }, @Req() req: any) {
    return this.auth.login(body, {
      userAgent: req.headers?.['user-agent'],
      ipAddress: req.ip || req.socket?.remoteAddress,
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
}
