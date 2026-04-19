import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ComplianceProfilesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(tenantId: string) {
    return this.prisma.complianceProfile.findMany({
      where: { tenantId }, orderBy: { key: 'asc' },
      include: { _count: { select: { assignments: true } } },
    });
  }

  async createOrUpdate(tenantId: string, body: { key: string; name: string; jurisdiction?: string; description?: string; domains?: string[]; obligationTemplateIds?: string[]; isActive?: boolean }) {
    if (!body.key || !body.name) throw new BadRequestException('key and name required');
    return this.prisma.complianceProfile.upsert({
      where: { tenantId_key: { tenantId, key: body.key } },
      create: {
        tenantId,
        key: body.key, name: body.name,
        jurisdiction: body.jurisdiction || null,
        description: body.description || null,
        domains: body.domains || [],
        obligationTemplateIds: body.obligationTemplateIds || [],
        isActive: body.isActive ?? true,
      },
      update: {
        name: body.name,
        jurisdiction: body.jurisdiction || null,
        description: body.description || null,
        domains: body.domains || [],
        obligationTemplateIds: body.obligationTemplateIds || [],
        isActive: body.isActive ?? true,
      },
    });
  }

  async assignToBuilding(tenantId: string, buildingIdOrSlug: string, profileKey: string, actorUserId: string) {
    const b = await this.prisma.building.findFirst({
      where: { tenantId, OR: [{ id: buildingIdOrSlug }, { slug: buildingIdOrSlug }] },
    });
    if (!b) throw new NotFoundException('building not found');
    const p = await this.prisma.complianceProfile.findUnique({
      where: { tenantId_key: { tenantId, key: profileKey } },
    });
    if (!p) throw new NotFoundException(`profile ${profileKey} not found`);
    return this.prisma.buildingComplianceProfile.upsert({
      where: { buildingId_profileId: { buildingId: b.id, profileId: p.id } },
      create: { tenantId, buildingId: b.id, profileId: p.id, assignedBy: actorUserId },
      update: {},
    });
  }

  async unassignFromBuilding(tenantId: string, buildingIdOrSlug: string, profileKey: string) {
    const b = await this.prisma.building.findFirst({
      where: { tenantId, OR: [{ id: buildingIdOrSlug }, { slug: buildingIdOrSlug }] },
    });
    if (!b) throw new NotFoundException('building not found');
    const p = await this.prisma.complianceProfile.findUnique({
      where: { tenantId_key: { tenantId, key: profileKey } },
    });
    if (!p) throw new NotFoundException('profile not found');
    await this.prisma.buildingComplianceProfile.deleteMany({
      where: { buildingId: b.id, profileId: p.id },
    });
    return { detached: true };
  }

  async forBuilding(tenantId: string, buildingIdOrSlug: string) {
    const b = await this.prisma.building.findFirst({
      where: { tenantId, OR: [{ id: buildingIdOrSlug }, { slug: buildingIdOrSlug }] },
    });
    if (!b) throw new NotFoundException('building not found');
    const items = await this.prisma.buildingComplianceProfile.findMany({
      where: { buildingId: b.id },
      include: { profile: true },
      orderBy: { assignedAt: 'asc' },
    });
    return { buildingId: b.id, buildingSlug: b.slug, total: items.length, items };
  }

  /**
   * Seed the built-in profiles (SI 1525 IL, ASHRAE 180, NFPA 25) into a tenant.
   * Each profile is tenant-scoped and can be disabled, overridden or cloned.
   */
  async seedBuiltIns(tenantId: string) {
    const allObligations = await this.prisma.obligationTemplate.findMany({
      where: { tenantId }, select: { id: true, domain: true, basisType: true },
    });

    const byDomain = (ds: string[]) => allObligations.filter((o) => o.domain && ds.includes(o.domain)).map((o) => o.id);

    const defs = [
      {
        key: 'IL-SI1525',
        name: 'SI 1525 (Israel)',
        jurisdiction: 'IL',
        description: 'Israeli Standard 1525 parts 3 & 4 — planned operation of non-residential building services + as-made documentation.',
        domains: ['fire_life_safety', 'electrical', 'water_plumbing', 'vertical_transport', 'hvac', 'ventilation', 'energy'],
        obligationTemplateIds: allObligations.filter((o) => o.basisType === 'statutory' || o.basisType === 'standard').map((o) => o.id),
      },
      {
        key: 'ASHRAE-180',
        name: 'ASHRAE 180',
        jurisdiction: 'global',
        description: 'Minimum HVAC inspection & maintenance requirements for commercial systems.',
        domains: ['hvac', 'ventilation'],
        obligationTemplateIds: byDomain(['hvac', 'ventilation']),
      },
      {
        key: 'NFPA-25',
        name: 'NFPA 25',
        jurisdiction: 'global',
        description: 'Inspection, testing and maintenance of water-based fire protection.',
        domains: ['fire_life_safety', 'water_plumbing'],
        obligationTemplateIds: byDomain(['fire_life_safety', 'water_plumbing']),
      },
    ];

    let created = 0;
    for (const d of defs) {
      await this.prisma.complianceProfile.upsert({
        where: { tenantId_key: { tenantId, key: d.key } },
        create: { tenantId, ...d, isBuiltIn: true, isActive: true },
        update: { ...d, isBuiltIn: true },
      });
      created += 1;
    }
    return { seeded: created };
  }
}
