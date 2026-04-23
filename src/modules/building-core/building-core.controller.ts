import { Body, Controller, Get, Headers, Param, Patch, Post, UnauthorizedException } from '@nestjs/common';
import { resolveTenantId } from '../../common/tenant.utils';
import { AuthService } from '../auth/auth.service';
import { BuildingCoreService } from './building-core.service';

async function userId(auth: string | undefined, s: AuthService): Promise<string> {
  if (!auth || !auth.startsWith('Bearer ')) throw new UnauthorizedException('no token');
  const p = await s.verifySession(auth.slice(7));
  if (!p) throw new UnauthorizedException('invalid or revoked token');
  return p.sub;
}

@Controller('buildings/:id')
export class BuildingCoreController {
  constructor(
    private readonly core: BuildingCoreService,
    private readonly auth: AuthService,
  ) {}

  @Get('summary')
  async summary(@Param('id') id: string, @Headers('x-tenant-id') th?: string) {
    return this.core.summary(resolveTenantId(th), id);
  }

  @Get('floors')
  async listFloors(@Param('id') id: string, @Headers('x-tenant-id') th?: string) {
    return this.core.listFloors(resolveTenantId(th), id);
  }

  @Post('floors')
  async createFloor(
    @Param('id') id: string,
    @Body() body: any,
    @Headers('x-tenant-id') th?: string,
    @Headers('authorization') ah?: string,
  ) {
    return this.core.createFloor(resolveTenantId(th), await userId(ah, this.auth), id, body);
  }

  @Get('locations')
  async listLocations(@Param('id') id: string, @Headers('x-tenant-id') th?: string) {
    return this.core.listLocations(resolveTenantId(th), id);
  }

  @Post('locations')
  async createLocation(
    @Param('id') id: string,
    @Body() body: any,
    @Headers('x-tenant-id') th?: string,
    @Headers('authorization') ah?: string,
  ) {
    return this.core.createLocation(resolveTenantId(th), await userId(ah, this.auth), id, body);
  }

  @Get('units')
  async listUnits(@Param('id') id: string, @Headers('x-tenant-id') th?: string) {
    return this.core.listUnits(resolveTenantId(th), id);
  }

  @Post('units')
  async createUnit(
    @Param('id') id: string,
    @Body() body: any,
    @Headers('x-tenant-id') th?: string,
    @Headers('authorization') ah?: string,
  ) {
    return this.core.createUnit(resolveTenantId(th), await userId(ah, this.auth), id, body);
  }

  @Patch('units/:unitId')
  async patchUnit(
    @Param('id') id: string,
    @Param('unitId') unitId: string,
    @Body() body: any,
    @Headers('x-tenant-id') th?: string,
    @Headers('authorization') ah?: string,
  ) {
    return this.core.updateUnit(resolveTenantId(th), await userId(ah, this.auth), id, unitId, body);
  }

  // Unit-groups: feature lives in monorepo but not yet ported to this split-repo's
  // Prisma schema (table `building_unit_groups` missing from Railway). Stub returns
  // empty list so the frontend stops 404-erroring when it opens a building page.
  @Get('unit-groups')
  async listUnitGroups() {
    return [];
  }

  @Get('transport')
  async listTransport(@Param('id') id: string, @Headers('x-tenant-id') th?: string) {
    return this.core.listTransport(resolveTenantId(th), id);
  }

  @Post('transport')
  async createTransport(
    @Param('id') id: string,
    @Body() body: any,
    @Headers('x-tenant-id') th?: string,
    @Headers('authorization') ah?: string,
  ) {
    return this.core.createTransport(resolveTenantId(th), await userId(ah, this.auth), id, body);
  }

  @Get('systems')
  async listSystems(@Param('id') id: string, @Headers('x-tenant-id') th?: string) {
    return this.core.listSystems(resolveTenantId(th), id);
  }

  @Post('systems')
  async createSystem(
    @Param('id') id: string,
    @Body() body: any,
    @Headers('x-tenant-id') th?: string,
    @Headers('authorization') ah?: string,
  ) {
    return this.core.createSystem(resolveTenantId(th), await userId(ah, this.auth), id, body);
  }

  @Patch('systems/:systemId')
  async patchSystem(
    @Param('id') id: string,
    @Param('systemId') systemId: string,
    @Body() body: any,
    @Headers('x-tenant-id') th?: string,
    @Headers('authorization') ah?: string,
  ) {
    return this.core.updateSystem(resolveTenantId(th), await userId(ah, this.auth), id, systemId, body);
  }

  @Get('occupants')
  async listOccupants(@Param('id') id: string, @Headers('x-tenant-id') th?: string) {
    return this.core.listOccupants(resolveTenantId(th), id);
  }

  @Post('occupants')
  async createOccupant(
    @Param('id') id: string,
    @Body() body: any,
    @Headers('x-tenant-id') th?: string,
    @Headers('authorization') ah?: string,
  ) {
    return this.core.createOccupant(resolveTenantId(th), await userId(ah, this.auth), id, body);
  }

  @Post('occupancies')
  async assignOccupancy(
    @Param('id') id: string,
    @Body() body: any,
    @Headers('x-tenant-id') th?: string,
    @Headers('authorization') ah?: string,
  ) {
    return this.core.assignOccupancy(resolveTenantId(th), await userId(ah, this.auth), id, body);
  }

  @Get('contracts')
  async listContracts(@Param('id') id: string, @Headers('x-tenant-id') th?: string) {
    return this.core.listContracts(resolveTenantId(th), id);
  }

  @Post('contracts')
  async createContract(
    @Param('id') id: string,
    @Body() body: any,
    @Headers('x-tenant-id') th?: string,
    @Headers('authorization') ah?: string,
  ) {
    return this.core.createContract(resolveTenantId(th), await userId(ah, this.auth), id, body);
  }

  @Get('parking')
  async listParking(@Param('id') id: string, @Headers('x-tenant-id') th?: string) {
    return this.core.listParking(resolveTenantId(th), id);
  }

  @Post('parking')
  async createParking(
    @Param('id') id: string, @Body() body: any,
    @Headers('x-tenant-id') th?: string, @Headers('authorization') ah?: string,
  ) {
    return this.core.createParking(resolveTenantId(th), await userId(ah, this.auth), id, body);
  }

  @Get('storage')
  async listStorage(@Param('id') id: string, @Headers('x-tenant-id') th?: string) {
    return this.core.listStorage(resolveTenantId(th), id);
  }

  @Post('storage')
  async createStorage(
    @Param('id') id: string, @Body() body: any,
    @Headers('x-tenant-id') th?: string, @Headers('authorization') ah?: string,
  ) {
    return this.core.createStorage(resolveTenantId(th), await userId(ah, this.auth), id, body);
  }

  @Get('equipment-relations')
  async listRelations(@Param('id') id: string, @Headers('x-tenant-id') th?: string) {
    return this.core.listEquipmentRelations(resolveTenantId(th), id);
  }

  @Post('equipment-relations')
  async createRelation(
    @Param('id') id: string, @Body() body: any,
    @Headers('x-tenant-id') th?: string, @Headers('authorization') ah?: string,
  ) {
    return this.core.createEquipmentRelation(resolveTenantId(th), await userId(ah, this.auth), id, body);
  }

  @Get('elevators')
  async listElevatorProfiles(@Param('id') id: string, @Headers('x-tenant-id') th?: string) {
    return this.core.listElevatorProfiles(resolveTenantId(th), id);
  }

  @Post('elevators')
  async upsertElevatorProfile(
    @Param('id') id: string, @Body() body: any,
    @Headers('x-tenant-id') th?: string, @Headers('authorization') ah?: string,
  ) {
    return this.core.upsertElevatorProfile(resolveTenantId(th), await userId(ah, this.auth), id, body);
  }

  @Get('sensors')
  async listSensorPoints(@Param('id') id: string, @Headers('x-tenant-id') th?: string) {
    return this.core.listSensorPoints(resolveTenantId(th), id);
  }

  @Post('sensors')
  async createSensorPoint(
    @Param('id') id: string, @Body() body: any,
    @Headers('x-tenant-id') th?: string, @Headers('authorization') ah?: string,
  ) {
    return this.core.createSensorPoint(resolveTenantId(th), await userId(ah, this.auth), id, body);
  }

  @Get('alarms')
  async listAlarmSources(@Param('id') id: string, @Headers('x-tenant-id') th?: string) {
    return this.core.listAlarmSources(resolveTenantId(th), id);
  }

  @Post('alarms')
  async createAlarmSource(
    @Param('id') id: string, @Body() body: any,
    @Headers('x-tenant-id') th?: string, @Headers('authorization') ah?: string,
  ) {
    return this.core.createAlarmSource(resolveTenantId(th), await userId(ah, this.auth), id, body);
  }

  @Patch('assets/:assetId/tags')
  async tagAsset(
    @Param('id') id: string, @Param('assetId') assetId: string, @Body() body: any,
    @Headers('x-tenant-id') th?: string, @Headers('authorization') ah?: string,
  ) {
    return this.core.tagAsset(resolveTenantId(th), await userId(ah, this.auth), id, assetId, body);
  }
}
