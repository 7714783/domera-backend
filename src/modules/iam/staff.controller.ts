import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { resolveTenantId } from '../../common/tenant.utils';
import { PrismaService } from '../../prisma/prisma.service';
import { IamService } from './iam.service';

@Controller('buildings/:slug/staff')
export class StaffController {
  constructor(
    private readonly iam: IamService,
    private readonly prisma: PrismaService,
  ) {}

  private async buildingId(tenantId: string, slug: string): Promise<string | null> {
    const b = await this.prisma.building.findFirst({
      where: { tenantId, slug },
      select: { id: true },
    });
    return b?.id || null;
  }

  @Get()
  async list(@Param('slug') slug: string, @Headers('x-tenant-id') tenantIdHeader?: string) {
    const tenantId = resolveTenantId(tenantIdHeader);
    const buildingId = await this.buildingId(tenantId, slug);
    if (!buildingId) return { total: 0, groups: [] };
    return this.iam.listBuildingStaff(tenantId, buildingId);
  }

  @Post()
  async create(
    @Param('slug') slug: string,
    @Body() body: any,
    @Headers('x-tenant-id') tenantIdHeader?: string,
    @Headers('x-actor-user-id') actorHeader?: string,
  ) {
    const tenantId = resolveTenantId(tenantIdHeader);
    const buildingId = await this.buildingId(tenantId, slug);
    if (!buildingId) return { error: 'building not found' };
    return this.iam.createStaff(tenantId, buildingId, actorHeader || 'system', body);
  }
}
