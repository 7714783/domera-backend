import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const QRCode: any = require('qrcode');
import { PrismaService } from '../../prisma/prisma.service';
import { MigratorPrismaService } from '../../prisma/prisma.migrator';

function shortCode(bytes = 8): string {
  // URL-safe short code, ~12 chars.
  return randomBytes(bytes)
    .toString('base64')
    .replace(/\+/g, '')
    .replace(/\//g, '')
    .replace(/=+$/g, '')
    .slice(0, 12);
}

// Canonical BuildingLocation.locationType → legacy CleaningZone.zoneType.
function mapLocationTypeToZoneType(locationType: string): string {
  const lc = (locationType || '').toLowerCase();
  if (lc === 'restroom' || lc === 'wc') return 'wc';
  if (lc === 'corridor') return 'corridor';
  if (lc === 'lobby') return 'lobby';
  if (lc === 'shared_area') return 'shared_area';
  if (lc === 'floor') return 'floor';
  if (lc === 'office' || lc === 'meeting_room' || lc === 'kitchen') return 'office';
  return 'custom';
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

  /**
   * Canonical location list for QR generation. Merges:
   *   - BuildingLocation rows (non-leasable: restrooms, corridors, lobbies, …)
   *   - BuildingUnit rows (leasable: offices, storage)
   *   - Legacy CleaningZone rows without a matching BuildingLocation/Unit
   *     (pre-refactor history)
   *
   * Each row carries `hasCleaningZone` + `cleaningZoneId` so the UI can show
   * which locations are already registered for cleaning. When a QR is
   * generated for a location without a CleaningZone, the service auto-upserts
   * a zone behind the scenes (see `create`).
   */
  async listLocations(tenantId: string, buildingId: string) {
    const [locations, units, zones, points, floors] = await Promise.all([
      this.prisma.buildingLocation.findMany({
        where: { tenantId, buildingId, isActive: true },
      }),
      this.prisma.buildingUnit.findMany({
        where: { tenantId, buildingId },
      }),
      this.prisma.cleaningZone.findMany({
        where: { tenantId, buildingId, isActive: true },
      }),
      this.prisma.cleaningQrPoint.findMany({
        where: { tenantId, buildingId },
        select: { zoneId: true, id: true },
      }),
      this.prisma.buildingFloor.findMany({
        where: { tenantId, buildingId },
        select: { id: true, floorCode: true, floorNumber: true, label: true },
      }),
    ]);

    const floorById = new Map(floors.map((f) => [f.id, f]));
    const qrCountByZone = new Map<string, number>();
    for (const p of points) qrCountByZone.set(p.zoneId, (qrCountByZone.get(p.zoneId) || 0) + 1);
    const zoneByCode = new Map(zones.map((z) => [z.code, z]));

    const rowForLocation = (args: {
      sourceKey: string;
      code: string;
      name: string;
      locationType: string;
      floorId: string;
      buildingLocationId: string | null;
      unitId: string | null;
    }) => {
      const zone = zoneByCode.get(args.code);
      const floor = floorById.get(args.floorId);
      return {
        sourceKey: args.sourceKey,
        code: args.code,
        name: args.name,
        locationType: args.locationType,
        floorId: args.floorId,
        floorCode: floor?.floorCode ?? null,
        floorNumber: floor?.floorNumber ?? null,
        buildingLocationId: args.buildingLocationId,
        unitId: args.unitId,
        cleaningZoneId: zone?.id ?? null,
        contractorId: zone?.contractorId ?? null,
        hasCleaningZone: !!zone,
        existingQrCount: zone ? qrCountByZone.get(zone.id) || 0 : 0,
      };
    };

    const rows = [
      ...locations.map((l) =>
        rowForLocation({
          sourceKey: `location:${l.id}`,
          code: l.code,
          name: l.name,
          locationType: l.locationType,
          floorId: l.floorId,
          buildingLocationId: l.id,
          unitId: l.unitId,
        }),
      ),
      ...units.map((u) =>
        rowForLocation({
          sourceKey: `unit:${u.id}`,
          code: u.unitCode,
          name: u.unitCode,
          locationType: u.unitType,
          floorId: u.floorId,
          buildingLocationId: null,
          unitId: u.id,
        }),
      ),
    ];

    // Keep pre-refactor CleaningZones visible (F1, WC-3, etc.) so the
    // operator doesn't lose history and can still re-generate their QRs.
    const seenCodes = new Set(rows.map((r) => r.code));
    for (const z of zones) {
      if (seenCodes.has(z.code)) continue;
      const floor = z.floorId ? floorById.get(z.floorId) : null;
      rows.push({
        sourceKey: `zone:${z.id}`,
        code: z.code,
        name: z.name,
        locationType: z.zoneType,
        floorId: z.floorId ?? '',
        floorCode: floor?.floorCode ?? null,
        floorNumber: floor?.floorNumber ?? null,
        buildingLocationId: null,
        unitId: null,
        cleaningZoneId: z.id,
        contractorId: z.contractorId,
        hasCleaningZone: true,
        existingQrCount: qrCountByZone.get(z.id) || 0,
      });
    }

    return rows.sort((a, b) => {
      const fa = a.floorNumber ?? Number.POSITIVE_INFINITY;
      const fb = b.floorNumber ?? Number.POSITIVE_INFINITY;
      if (fa !== fb) return fa - fb;
      return a.code.localeCompare(b.code);
    });
  }

  /**
   * Ensure a CleaningZone exists for the given canonical location
   * (BuildingLocation / BuildingUnit / legacy CleaningZone). Returns the
   * CleaningZone id. Idempotent: if a zone with the same code already exists
   * in this building, it is reused. Called by `create` when the caller picked
   * a location that isn't yet registered in cleaning.
   */
  private async ensureCleaningZoneFor(
    tenantId: string,
    buildingId: string,
    sourceKey: string,
  ): Promise<{ zoneId: string; locationId: string | null }> {
    const [kind, id] = sourceKey.split(':');
    if (!kind || !id) throw new BadRequestException('invalid sourceKey');

    if (kind === 'zone') {
      const z = await this.prisma.cleaningZone.findFirst({ where: { id, tenantId, buildingId } });
      if (!z) throw new NotFoundException('cleaning zone not found');
      return { zoneId: z.id, locationId: null };
    }

    let code: string, name: string, zoneType: string, floorId: string, locationId: string | null;
    if (kind === 'location') {
      const loc = await this.prisma.buildingLocation.findFirst({
        where: { id, tenantId, buildingId },
      });
      if (!loc) throw new NotFoundException('location not found');
      code = loc.code;
      name = loc.name;
      floorId = loc.floorId;
      locationId = loc.id;
      zoneType = mapLocationTypeToZoneType(loc.locationType);
    } else if (kind === 'unit') {
      const u = await this.prisma.buildingUnit.findFirst({ where: { id, tenantId, buildingId } });
      if (!u) throw new NotFoundException('unit not found');
      code = u.unitCode;
      name = u.unitCode;
      floorId = u.floorId;
      locationId = null;
      zoneType = mapLocationTypeToZoneType(u.unitType);
    } else {
      throw new BadRequestException(`unknown sourceKey kind: ${kind}`);
    }

    const existing = await this.prisma.cleaningZone.findFirst({
      where: { tenantId, buildingId, code },
    });
    if (existing) return { zoneId: existing.id, locationId };

    const zone = await this.prisma.cleaningZone.create({
      data: {
        tenantId,
        buildingId,
        floorId,
        code,
        name,
        zoneType,
        locationId,
      },
    });
    return { zoneId: zone.id, locationId };
  }

  async renderImage(tenantId: string, id: string, opts: { format?: 'svg' | 'png'; size?: number }) {
    const qr = await this.prisma.cleaningQrPoint.findFirst({
      where: { id, tenantId },
    });
    if (!qr) throw new NotFoundException('QR point not found');
    const size = Math.min(Math.max(opts.size ?? 512, 128), 2048);
    const format = opts.format === 'png' ? 'png' : 'svg';
    if (format === 'svg') {
      const svg = await QRCode.toString(qr.publicUrl, {
        type: 'svg',
        margin: 2,
        errorCorrectionLevel: 'M',
        width: size,
      });
      return { mime: 'image/svg+xml', body: svg, filename: `cleaning-qr-${qr.code}.svg` };
    }
    const png = await QRCode.toBuffer(qr.publicUrl, {
      type: 'png',
      margin: 2,
      errorCorrectionLevel: 'M',
      width: size,
    });
    return { mime: 'image/png', body: png, filename: `cleaning-qr-${qr.code}.png` };
  }

  /**
   * Create a QR point for a location. Accepts either:
   *   - `sourceKey` (preferred): "location:<id>" | "unit:<id>" | "zone:<id>"
   *     — the service resolves to a CleaningZone, auto-creating one if the
   *     canonical location wasn't yet registered in cleaning.
   *   - `zoneId` (legacy): direct CleaningZone id.
   */
  async create(
    tenantId: string,
    body: {
      buildingId: string;
      zoneId?: string;
      sourceKey?: string;
      locationId?: string;
      label: string;
      // Intentionally not accepted — the public scan code is server-generated
      // (collision-checked) and surfacing a client-supplied value would let
      // callers conflict with each other or guess existing codes. Reject
      // explicitly instead of silently dropping it.
      code?: never;
    },
  ) {
    if (!body.buildingId || !body.label) {
      throw new BadRequestException('buildingId and label required');
    }
    if (!body.zoneId && !body.sourceKey) {
      throw new BadRequestException('sourceKey or zoneId required');
    }
    if ((body as any).code !== undefined) {
      throw new BadRequestException(
        'code is server-generated — omit the `code` field from the request body',
      );
    }

    let zoneId = body.zoneId ?? null;
    let locationId = body.locationId ?? null;
    if (!zoneId && body.sourceKey) {
      const resolved = await this.ensureCleaningZoneFor(tenantId, body.buildingId, body.sourceKey);
      zoneId = resolved.zoneId;
      locationId = locationId || resolved.locationId;
    }
    if (!zoneId) throw new BadRequestException('zoneId or sourceKey required');

    const zone = await this.prisma.cleaningZone.findFirst({
      where: { id: zoneId, tenantId, buildingId: body.buildingId },
    });
    if (!zone) throw new NotFoundException('zone not found in this building');

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
        tenantId,
        buildingId: body.buildingId,
        zoneId: zone.id,
        locationId,
        code,
        label: body.label,
        publicUrl,
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
      this.migrator.building.findUnique({
        where: { id: qr.buildingId },
        select: { id: true, name: true },
      }),
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
      categories: [
        'regular_cleaning',
        'urgent_cleaning',
        'spill',
        'restroom_issue',
        'trash_overflow',
        'other',
      ],
    };
  }
}
