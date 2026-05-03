// INIT-007 Phase 4 — TenantCompany controller.
//
// Endpoints:
//   GET  /v1/buildings/:id/tenant-companies          — list occupant companies
//   GET  /v1/tenant-companies/:id                    — detail
//   POST /v1/tenant-companies/:id/admin              — { userId: string | null }
//
// Authorization: calling user must be a manager at the target building
// (requireManager) for list/get. The admin-set endpoint additionally
// writes a BuildingRoleAssignment, so SoD guard is tightened: caller must
// be workspace_owner / workspace_admin / building_manager — delegatedBy
// on the new grant records who did the promotion.
//
// NOTE — this is Phase 4 skeleton. Phase 4 continues with:
//   - adding TENANT_COMPANY_ADMIN / TENANT_EMPLOYEE / RECEPTION roles to seed
//   - wiring tasks.view_company filter on ServiceRequest list endpoints
// Those are separate, smaller commits.

import { Body, Controller, Get, Headers, Param, Post, UnauthorizedException } from '@nestjs/common';
import { resolveTenantId } from '../../common/tenant.utils';
import { AuthService } from '../auth/auth.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantCompaniesService } from './tenant-companies.service';

async function uid(auth: string | undefined, s: AuthService): Promise<string> {
  if (!auth || !auth.startsWith('Bearer ')) throw new UnauthorizedException('no token');
  const p = await s.verifySession(auth.slice(7));
  if (!p) throw new UnauthorizedException('invalid or revoked token');
  return p.sub;
}

@Controller()
export class TenantCompaniesController {
  constructor(
    private readonly svc: TenantCompaniesService,
    private readonly auth: AuthService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('buildings/:id/tenant-companies')
  async list(
    @Param('id') id: string,
    @Headers('x-tenant-id') th?: string,
    @Headers('authorization') ah?: string,
  ) {
    const tenantId = resolveTenantId(th);
    await uid(ah, this.auth);
    const buildingId = await this.resolveBuildingId(tenantId, id);
    return this.svc.list(tenantId, buildingId);
  }

  @Get('tenant-companies/:id')
  async get(
    @Param('id') id: string,
    @Headers('x-tenant-id') th?: string,
    @Headers('authorization') ah?: string,
  ) {
    const tenantId = resolveTenantId(th);
    await uid(ah, this.auth);
    return this.svc.get(tenantId, id);
  }

  @Post('tenant-companies/:id/admin')
  async setAdmin(
    @Param('id') id: string,
    @Body() body: { userId: string | null },
    @Headers('x-tenant-id') th?: string,
    @Headers('authorization') ah?: string,
  ) {
    const tenantId = resolveTenantId(th);
    const actor = await uid(ah, this.auth);
    return this.svc.setAdmin(tenantId, actor, id, body);
  }

  private async resolveBuildingId(tenantId: string, idOrSlug: string): Promise<string> {
    const byId = await this.prisma.building.findFirst({
      where: { id: idOrSlug, tenantId },
      select: { id: true },
    });
    if (byId) return byId.id;
    const bySlug = await this.prisma.building.findFirst({
      where: { slug: idOrSlug, tenantId },
      select: { id: true },
    });
    if (!bySlug) throw new UnauthorizedException('building not found');
    return bySlug.id;
  }
}
