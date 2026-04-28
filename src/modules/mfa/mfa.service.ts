import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { newSecret, otpauthUrl, verifyTotp } from './totp';

const PRIVILEGED_ROLES = new Set([
  'workspace_owner',
  'workspace_admin',
  'finance_controller',
  'approver',
  'owner_representative',
]);

@Injectable()
export class MfaService {
  constructor(private readonly prisma: PrismaService) {}

  async status(userId: string) {
    const row = await this.prisma.userMfa.findUnique({ where: { userId } });
    return {
      enrolled: !!row?.enabledAt,
      createdAt: row?.createdAt || null,
      lastUsedAt: row?.lastUsedAt || null,
    };
  }

  async enrollStart(userId: string, userLabel: string) {
    const existing = await this.prisma.userMfa.findUnique({ where: { userId } });
    if (existing?.enabledAt) throw new BadRequestException('MFA already enrolled; disable first');
    const secret = newSecret();
    await this.prisma.userMfa.upsert({
      where: { userId },
      create: { userId, secret },
      update: { secret, enabledAt: null },
    });
    return {
      secret,
      otpauth: otpauthUrl({ secret, label: userLabel, issuer: 'Domera' }),
    };
  }

  async enrollVerify(userId: string, code: string) {
    const row = await this.prisma.userMfa.findUnique({ where: { userId } });
    if (!row) throw new NotFoundException('enrollment not started');
    if (!verifyTotp(row.secret, code)) throw new BadRequestException('code invalid');
    return this.prisma.userMfa.update({
      where: { userId },
      data: { enabledAt: new Date(), lastUsedAt: new Date() },
    });
  }

  async disable(userId: string, code: string) {
    const row = await this.prisma.userMfa.findUnique({ where: { userId } });
    if (!row?.enabledAt) throw new BadRequestException('MFA not enrolled');
    if (!verifyTotp(row.secret, code)) throw new BadRequestException('code invalid');
    await this.prisma.userMfa.delete({ where: { userId } });
    return { ok: true };
  }

  /**
   * Verify a code during a sensitive operation (called by privileged workflows
   * before they proceed). Returns true if the user doesn't need MFA (not
   * enrolled AND not in a privileged role), or the code verifies.
   */
  async requireCode(
    userId: string,
    code: string | undefined,
    role?: string,
  ): Promise<{ ok: boolean; required: boolean; reason?: string }> {
    const row = await this.prisma.userMfa.findUnique({ where: { userId } });
    const mfaRequired = PRIVILEGED_ROLES.has(role || '') || !!row?.enabledAt;
    if (!mfaRequired) return { ok: true, required: false };
    if (!row?.enabledAt)
      return { ok: false, required: true, reason: 'MFA required for this role but not enrolled' };
    if (!code) return { ok: false, required: true, reason: 'MFA code required' };
    const ok = verifyTotp(row.secret, code);
    if (ok) {
      await this.prisma.userMfa.update({ where: { userId }, data: { lastUsedAt: new Date() } });
      return { ok: true, required: true };
    }
    return { ok: false, required: true, reason: 'MFA code invalid' };
  }
}
