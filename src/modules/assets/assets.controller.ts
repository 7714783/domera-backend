import { Body, Controller, Delete, Get, Headers, Param, Patch, Post, Query, UnauthorizedException } from '@nestjs/common';
import { resolveTenantId } from '../../common/tenant.utils';
import { AuthService } from '../auth/auth.service';
import { AssetsService } from './assets.service';

async function uid(auth: string | undefined, s: AuthService): Promise<string> {
  if (!auth || !auth.startsWith('Bearer ')) throw new UnauthorizedException('no token');
  const p = await s.verifySession(auth.slice(7));
  if (!p) throw new UnauthorizedException('invalid or revoked token');
  return p.sub;
}

@Controller()
export class AssetsController {
  constructor(
    private readonly svc: AssetsService,
    private readonly auth: AuthService,
  ) {}

  // Registry + CRUD (building-scoped list, flat CRUD on asset id)
  @Get('buildings/:id/assets')
  list(
    @Param('id') id: string,
    @Query('systemFamily') systemFamily?: string,
    @Query('assetLevel') assetLevel?: string,
    @Query('assetTypeId') assetTypeId?: string,
    @Query('riskCriticality') riskCriticality?: string,
    @Query('lifecycleStatus') lifecycleStatus?: string,
    @Query('conditionState') conditionState?: string,
    @Query('locationId') locationId?: string,
    @Query('search') search?: string,
    @Query('take') take?: string,
    @Query('skip') skip?: string,
    @Headers('x-tenant-id') th?: string,
  ) {
    return this.svc.list(resolveTenantId(th), id, {
      systemFamily, assetLevel, assetTypeId, riskCriticality,
      lifecycleStatus, conditionState, locationId, search,
      take: take ? Number(take) : undefined,
      skip: skip ? Number(skip) : undefined,
    });
  }

  @Post('buildings/:id/assets')
  async create(
    @Param('id') id: string, @Body() body: any,
    @Headers('x-tenant-id') th?: string, @Headers('authorization') ah?: string,
  ) {
    return this.svc.create(resolveTenantId(th), await uid(ah, this.auth), id, body);
  }

  @Post('buildings/:id/assets/bulk-import')
  async bulkImport(
    @Param('id') id: string, @Body() body: { items: any[]; validateOnly?: boolean },
    @Headers('x-tenant-id') th?: string, @Headers('authorization') ah?: string,
  ) {
    return this.svc.bulkImport(resolveTenantId(th), await uid(ah, this.auth), id, body || { items: [] });
  }

  @Get('assets/:id')
  get(@Param('id') id: string, @Headers('x-tenant-id') th?: string) {
    return this.svc.get(resolveTenantId(th), id);
  }

  @Patch('assets/:id')
  async update(
    @Param('id') id: string, @Body() body: any,
    @Headers('x-tenant-id') th?: string, @Headers('authorization') ah?: string,
  ) {
    return this.svc.update(resolveTenantId(th), await uid(ah, this.auth), id, body);
  }

  @Delete('assets/:id')
  async softDelete(
    @Param('id') id: string,
    @Headers('x-tenant-id') th?: string, @Headers('authorization') ah?: string,
  ) {
    return this.svc.softDelete(resolveTenantId(th), await uid(ah, this.auth), id);
  }

  // Custom attributes
  @Post('assets/:id/custom-attributes')
  setAttr(@Param('id') id: string, @Body() body: any, @Headers('x-tenant-id') th?: string) {
    return this.svc.setCustomAttribute(resolveTenantId(th), id, body);
  }

  @Delete('assets/:id/custom-attributes/:key')
  removeAttr(@Param('id') id: string, @Param('key') key: string, @Headers('x-tenant-id') th?: string) {
    return this.svc.removeCustomAttribute(resolveTenantId(th), id, key);
  }

  // Documents (typed attach via existing Document)
  @Post('assets/:id/documents')
  attachDoc(@Param('id') id: string, @Body() body: any, @Headers('x-tenant-id') th?: string) {
    return this.svc.attachDocument(resolveTenantId(th), id, body);
  }

  @Delete('assets/documents/:linkId')
  detachDoc(@Param('linkId') linkId: string, @Headers('x-tenant-id') th?: string) {
    return this.svc.detachDocument(resolveTenantId(th), linkId);
  }

  // Media
  @Post('assets/:id/media')
  addMedia(@Param('id') id: string, @Body() body: any, @Headers('x-tenant-id') th?: string) {
    return this.svc.attachMedia(resolveTenantId(th), id, body);
  }

  @Delete('assets/media/:mediaId')
  delMedia(@Param('mediaId') mediaId: string, @Headers('x-tenant-id') th?: string) {
    return this.svc.removeMedia(resolveTenantId(th), mediaId);
  }

  // PPM linkage — attach / detach / list plan items bound to this asset
  @Get('assets/:id/ppm')
  listPpm(@Param('id') id: string, @Headers('x-tenant-id') th?: string) {
    return this.svc.listPpm(resolveTenantId(th), id);
  }

  @Post('assets/:id/ppm/attach')
  async attachPpm(
    @Param('id') id: string, @Body() body: { planItemId: string },
    @Headers('x-tenant-id') th?: string, @Headers('authorization') ah?: string,
  ) {
    return this.svc.attachPpm(resolveTenantId(th), await uid(ah, this.auth), id, body?.planItemId);
  }

  @Post('assets/:id/ppm/detach')
  async detachPpm(
    @Param('id') id: string, @Body() body: { planItemId: string },
    @Headers('x-tenant-id') th?: string, @Headers('authorization') ah?: string,
  ) {
    return this.svc.detachPpm(resolveTenantId(th), await uid(ah, this.auth), id, body?.planItemId);
  }

  // Asset types catalogue
  @Get('asset-types')
  listTypes(@Query('systemFamily') systemFamily?: string, @Headers('x-tenant-id') th?: string) {
    return this.svc.listAssetTypes(resolveTenantId(th), systemFamily);
  }

  @Post('asset-types')
  createType(@Body() body: any, @Headers('x-tenant-id') th?: string) {
    return this.svc.createAssetType(resolveTenantId(th), body);
  }
}
