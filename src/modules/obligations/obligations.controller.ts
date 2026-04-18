import { Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { resolveTenantId } from '../../common/tenant.utils';
import { ApplicabilityService } from './applicability.service';
import { PrismaService } from '../../prisma/prisma.service';

@Controller('buildings/:slug')
export class ObligationsController {
  constructor(
    private readonly applicability: ApplicabilityService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('obligations/apply-templates')
  async applyTemplates(@Param('slug') slug: string, @Headers('x-tenant-id') tenantIdHeader?: string) {
    const tenantId = resolveTenantId(tenantIdHeader);
    const building = await this.prisma.building.findFirst({ where: { tenantId, slug } });
    if (!building) return { error: 'building not found' };
    const result = await this.applicability.applyTemplatesToBuilding(tenantId, building.id);
    return { building: { id: building.id, slug: building.slug }, ...result };
  }

  @Get('obligations')
  async list(@Param('slug') slug: string, @Headers('x-tenant-id') tenantIdHeader?: string) {
    const tenantId = resolveTenantId(tenantIdHeader);
    const building = await this.prisma.building.findFirst({ where: { tenantId, slug } });
    if (!building) return { total: 0, items: [] };
    const items = await this.prisma.buildingObligation.findMany({
      where: { tenantId, buildingId: building.id },
      include: { obligation: { include: { bases: true, applicabilityRules: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return { total: items.length, items };
  }
}
