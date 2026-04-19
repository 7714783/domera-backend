import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { MigratorPrismaService } from '../../prisma/prisma.migrator';

function shortCode(bytes = 8): string {
  // URL-safe short code, ~12 chars.
  return randomBytes(bytes).toString('base64')
    .replace(/\+/g, '').replace(/\//g, '').replace(/=+$/g, '')
    .slice(0, 12);
}

@Injectable()
export class CleaningQrService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly migrator: MigratorPrismaService,
  ) {}

  async list(tenantId: string, buildingId?: string) {
    return this.prisma.cleaningQrPoint.findMany({
      where: { tenantId, ...(buildingId ? { buildingId } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  async create(tenantId: string, body: {
    buildingId: string; zoneId: string; locationId?: string; label: string;
  }) {
    if (!body.buildingId || !body.zoneId || !body.label) {
      throw new BadRequestException('buildingId, zoneId, label required');
    }
    const zone = await this.prisma.cleaningZone.findFirst({
      where: { id: body.zoneId, tenantId, buildingId: body.buildingId },
    });
    if (!zone) throw new NotFoundException('zone not found in this building');

    // Find unique code (tiny loop in case of collision)
    let code = shortCode();
    for (let i = 0; i < 5; i++) {
      const hit = await this.prisma.cleaningQrPoint.findUnique({ where: { code } });
      if (!hit) break;
      code = shortCode();
    }
    const base = process.env.APP_URL || 'http://localhost:3000';
    const publicUrl = `${base}/qr/cleaning/${code}`;
    return this.prisma.cleaningQrPoint.create({
      data: {
        tenantId, buildingId: body.buildingId, zoneId: body.zoneId,
        locationId: body.locationId || null,
        code, label: body.label, publicUrl,
      },
    });
  }

  async resolvePublic(code: string) {
    // Use migrator client: public caller has no tenant context + app role is
    // NOBYPASSRLS, so a direct query would hit RLS default-deny.
    const qr = await this.migrator.cleaningQrPoint.findUnique({ where: { code } });
    if (!qr || !qr.isActive) throw new NotFoundException('cleaning QR not found or inactive');
    const [zone, building] = await Promise.all([
      this.migrator.cleaningZone.findUnique({ where: { id: qr.zoneId } }),
      this.migrator.building.findUnique({ where: { id: qr.buildingId }, select: { id: true, name: true } }),
    ]);
    if (!zone || !building) throw new NotFoundException('zone/building not found');

    // Touch lastScannedAt
    await this.migrator.cleaningQrPoint.update({
      where: { id: qr.id },
      data: { lastScannedAt: new Date() },
    });

    return {
      code: qr.code,
      label: qr.label,
      building: { id: building.id, name: building.name },
      zone: { id: zone.id, name: zone.name, zoneType: zone.zoneType, code: zone.code },
      // Categories the user can pick from on the public form.
      categories: ['regular_cleaning', 'urgent_cleaning', 'spill', 'restroom_issue', 'trash_overflow', 'other'],
    };
  }
}
