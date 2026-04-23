import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export type RegisterDeviceBody = {
  expoPushToken: string;
  platform: 'ios' | 'android' | 'web';
  osVersion?: string;
  appVersion?: string;
};

@Injectable()
export class DevicesService {
  constructor(private readonly prisma: PrismaService) {}

  async register(tenantId: string, userId: string, body: RegisterDeviceBody) {
    if (!body?.expoPushToken || body.expoPushToken.length < 8) {
      throw new BadRequestException('expoPushToken required');
    }
    if (!['ios', 'android', 'web'].includes(body?.platform)) {
      throw new BadRequestException('platform must be ios | android | web');
    }
    // Upsert-by-token: if the same push token re-appears (user reinstalls the
    // app, roams between devices, etc.) we update the existing row rather than
    // duplicate. Tenant+user are refreshed from the current auth context.
    return this.prisma.device.upsert({
      where: { expoPushToken: body.expoPushToken },
      update: {
        tenantId,
        userId,
        platform: body.platform,
        osVersion: body.osVersion ?? null,
        appVersion: body.appVersion ?? null,
        lastSeenAt: new Date(),
      },
      create: {
        tenantId,
        userId,
        platform: body.platform,
        expoPushToken: body.expoPushToken,
        osVersion: body.osVersion ?? null,
        appVersion: body.appVersion ?? null,
      },
    });
  }

  async list(tenantId: string, userId: string) {
    return this.prisma.device.findMany({
      where: { tenantId, userId },
      orderBy: { lastSeenAt: 'desc' },
    });
  }

  async unregister(tenantId: string, userId: string, deviceId: string) {
    // Guard: the device must belong to the caller in the current tenant.
    const row = await this.prisma.device.findFirst({
      where: { id: deviceId, tenantId, userId },
    });
    if (!row) return { deleted: false };
    await this.prisma.device.delete({ where: { id: row.id } });
    return { deleted: true };
  }
}
