import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { resolveTenantId } from '../../common/tenant.utils';
import { AuthService } from '../auth/auth.service';
import { OccupantsService } from './occupants.service';

async function userId(auth: string | undefined, s: AuthService): Promise<string> {
  if (!auth || !auth.startsWith('Bearer ')) throw new UnauthorizedException('no token');
  const p = await s.verifySession(auth.slice(7));
  if (!p) throw new UnauthorizedException('invalid or revoked token');
  return p.sub;
}

// Portfolio-wide list.
@Controller('tenants')
export class OccupantsPortfolioController {
  constructor(private readonly svc: OccupantsService) {}

  @Get()
  async list(@Headers('x-tenant-id') th?: string) {
    return this.svc.listPortfolio(resolveTenantId(th));
  }
}

// Building-scoped CRUD + settings.
@Controller('buildings/:buildingId/tenants')
export class OccupantsController {
  constructor(
    private readonly svc: OccupantsService,
    private readonly auth: AuthService,
  ) {}

  @Get()
  async list(@Param('buildingId') buildingId: string, @Headers('x-tenant-id') th?: string) {
    return this.svc.listForBuilding(resolveTenantId(th), buildingId);
  }

  @Post()
  async create(
    @Param('buildingId') buildingId: string,
    @Body() body: any,
    @Headers('x-tenant-id') th?: string,
    @Headers('authorization') ah?: string,
  ) {
    return this.svc.createTenant(
      resolveTenantId(th),
      await userId(ah, this.auth),
      buildingId,
      body,
    );
  }

  @Get(':id')
  async getOne(
    @Param('buildingId') buildingId: string,
    @Param('id') id: string,
    @Headers('x-tenant-id') th?: string,
  ) {
    return this.svc.getOne(resolveTenantId(th), buildingId, id);
  }

  @Patch(':id')
  async patchProfile(
    @Param('buildingId') buildingId: string,
    @Param('id') id: string,
    @Body() body: any,
    @Headers('x-tenant-id') th?: string,
    @Headers('authorization') ah?: string,
  ) {
    return this.svc.patchProfile(
      resolveTenantId(th),
      await userId(ah, this.auth),
      buildingId,
      id,
      body,
    );
  }

  @Patch(':id/settings')
  async upsertSettings(
    @Param('buildingId') buildingId: string,
    @Param('id') id: string,
    @Body() body: any,
    @Headers('x-tenant-id') th?: string,
    @Headers('authorization') ah?: string,
  ) {
    return this.svc.upsertSettings(
      resolveTenantId(th),
      await userId(ah, this.auth),
      buildingId,
      id,
      body,
    );
  }
}
