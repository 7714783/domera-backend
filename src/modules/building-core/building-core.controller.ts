import { Body, Controller, Get, Headers, Param, Patch, Post, UnauthorizedException } from '@nestjs/common';
import { resolveTenantId } from '../../common/tenant.utils';
import { AuthService } from '../auth/auth.service';
import { BuildingCoreService } from './building-core.service';

function userId(auth: string | undefined, s: AuthService): string {
  if (!auth || !auth.startsWith('Bearer ')) throw new UnauthorizedException('no token');
  const p = s.verify(auth.slice(7));
  if (!p) throw new UnauthorizedException('invalid token');
  return p.sub;
}

@Controller('buildings/:id')
export class BuildingCoreController {
  constructor(
    private readonly core: BuildingCoreService,
    private readonly auth: AuthService,
  ) {}

  @Get('summary')
  summary(@Param('id') id: string, @Headers('x-tenant-id') th?: string) {
    return this.core.summary(resolveTenantId(th), id);
  }

  @Get('floors')
  listFloors(@Param('id') id: string, @Headers('x-tenant-id') th?: string) {
    return this.core.listFloors(resolveTenantId(th), id);
  }

  @Post('floors')
  createFloor(
    @Param('id') id: string,
    @Body() body: any,
    @Headers('x-tenant-id') th?: string,
    @Headers('authorization') ah?: string,
  ) {
    return this.core.createFloor(resolveTenantId(th), userId(ah, this.auth), id, body);
  }

  @Get('units')
  listUnits(@Param('id') id: string, @Headers('x-tenant-id') th?: string) {
    return this.core.listUnits(resolveTenantId(th), id);
  }

  @Post('units')
  createUnit(
    @Param('id') id: string,
    @Body() body: any,
    @Headers('x-tenant-id') th?: string,
    @Headers('authorization') ah?: string,
  ) {
    return this.core.createUnit(resolveTenantId(th), userId(ah, this.auth), id, body);
  }

  @Patch('units/:unitId')
  patchUnit(
    @Param('id') id: string,
    @Param('unitId') unitId: string,
    @Body() body: any,
    @Headers('x-tenant-id') th?: string,
    @Headers('authorization') ah?: string,
  ) {
    return this.core.updateUnit(resolveTenantId(th), userId(ah, this.auth), id, unitId, body);
  }

  @Get('transport')
  listTransport(@Param('id') id: string, @Headers('x-tenant-id') th?: string) {
    return this.core.listTransport(resolveTenantId(th), id);
  }

  @Post('transport')
  createTransport(
    @Param('id') id: string,
    @Body() body: any,
    @Headers('x-tenant-id') th?: string,
    @Headers('authorization') ah?: string,
  ) {
    return this.core.createTransport(resolveTenantId(th), userId(ah, this.auth), id, body);
  }

  @Get('systems')
  listSystems(@Param('id') id: string, @Headers('x-tenant-id') th?: string) {
    return this.core.listSystems(resolveTenantId(th), id);
  }

  @Post('systems')
  createSystem(
    @Param('id') id: string,
    @Body() body: any,
    @Headers('x-tenant-id') th?: string,
    @Headers('authorization') ah?: string,
  ) {
    return this.core.createSystem(resolveTenantId(th), userId(ah, this.auth), id, body);
  }

  @Patch('systems/:systemId')
  patchSystem(
    @Param('id') id: string,
    @Param('systemId') systemId: string,
    @Body() body: any,
    @Headers('x-tenant-id') th?: string,
    @Headers('authorization') ah?: string,
  ) {
    return this.core.updateSystem(resolveTenantId(th), userId(ah, this.auth), id, systemId, body);
  }

  @Get('occupants')
  listOccupants(@Param('id') id: string, @Headers('x-tenant-id') th?: string) {
    return this.core.listOccupants(resolveTenantId(th), id);
  }

  @Post('occupants')
  createOccupant(
    @Param('id') id: string,
    @Body() body: any,
    @Headers('x-tenant-id') th?: string,
    @Headers('authorization') ah?: string,
  ) {
    return this.core.createOccupant(resolveTenantId(th), userId(ah, this.auth), id, body);
  }

  @Post('occupancies')
  assignOccupancy(
    @Param('id') id: string,
    @Body() body: any,
    @Headers('x-tenant-id') th?: string,
    @Headers('authorization') ah?: string,
  ) {
    return this.core.assignOccupancy(resolveTenantId(th), userId(ah, this.auth), id, body);
  }

  @Get('contracts')
  listContracts(@Param('id') id: string, @Headers('x-tenant-id') th?: string) {
    return this.core.listContracts(resolveTenantId(th), id);
  }

  @Post('contracts')
  createContract(
    @Param('id') id: string,
    @Body() body: any,
    @Headers('x-tenant-id') th?: string,
    @Headers('authorization') ah?: string,
  ) {
    return this.core.createContract(resolveTenantId(th), userId(ah, this.auth), id, body);
  }
}
