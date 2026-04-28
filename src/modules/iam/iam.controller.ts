import { Body, Controller, Delete, Get, Headers, Param, Post } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { resolveTenantId } from '../../common/tenant.utils';
import { IamService } from './iam.service';

@Controller('buildings/:slug/roles')
export class IamController {
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

  @Post('assign')
  async assign(
    @Param('slug') slug: string,
    @Body() body: { userId: string; roleKey: string; expiresAt?: string | null },
    @Headers('x-tenant-id') tenantIdHeader?: string,
    @Headers('x-actor-user-id') actorHeader?: string,
  ) {
    const tenantId = resolveTenantId(tenantIdHeader);
    const buildingId = await this.buildingId(tenantId, slug);
    if (!buildingId) return { error: 'building not found' };
    return this.iam.assign(tenantId, buildingId, actorHeader || 'system', body);
  }

  @Get()
  async list(@Param('slug') slug: string, @Headers('x-tenant-id') tenantIdHeader?: string) {
    const tenantId = resolveTenantId(tenantIdHeader);
    const buildingId = await this.buildingId(tenantId, slug);
    if (!buildingId) return { total: 0, items: [] };
    return this.iam.list(tenantId, buildingId);
  }

  @Delete(':assignmentId')
  async revoke(
    @Param('slug') slug: string,
    @Param('assignmentId') assignmentId: string,
    @Headers('x-tenant-id') tenantIdHeader?: string,
    @Headers('x-actor-user-id') actorHeader?: string,
  ) {
    const tenantId = resolveTenantId(tenantIdHeader);
    const buildingId = await this.buildingId(tenantId, slug);
    if (!buildingId) return { error: 'building not found' };
    return this.iam.revoke(tenantId, buildingId, actorHeader || 'system', assignmentId);
  }
}
