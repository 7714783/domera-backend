import { BadRequestException, Body, Controller, Get, Headers, Post, UnauthorizedException } from '@nestjs/common';
import { AuthService } from '../auth/auth.service';
import { MfaService } from './mfa.service';
import { PrismaService } from '../../prisma/prisma.service';

async function uid(auth: string | undefined, s: AuthService): Promise<string> {
  if (!auth || !auth.startsWith('Bearer ')) throw new UnauthorizedException('no token');
  const p = await s.verifySession(auth.slice(7));
  if (!p) throw new UnauthorizedException('invalid or revoked token');
  return p.sub;
}

@Controller('mfa')
export class MfaController {
  constructor(
    private readonly svc: MfaService,
    private readonly auth: AuthService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('status')
  async status(@Headers('authorization') ah?: string) {
    return this.svc.status(await uid(ah, this.auth));
  }

  @Post('enroll/start')
  async enrollStart(@Headers('authorization') ah?: string) {
    const userId = await uid(ah, this.auth);
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { email: true, emailNormalized: true, displayName: true } });
    if (!user) throw new BadRequestException('user not found');
    const label = user.email || user.emailNormalized || userId;
    return this.svc.enrollStart(userId, label);
  }

  @Post('enroll/verify')
  async enrollVerify(@Body() body: { code: string }, @Headers('authorization') ah?: string) {
    if (!body?.code) throw new BadRequestException('code required');
    return this.svc.enrollVerify(await uid(ah, this.auth), body.code);
  }

  @Post('disable')
  async disable(@Body() body: { code: string }, @Headers('authorization') ah?: string) {
    if (!body?.code) throw new BadRequestException('code required');
    return this.svc.disable(await uid(ah, this.auth), body.code);
  }
}
