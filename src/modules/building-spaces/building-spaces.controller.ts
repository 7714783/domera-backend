// INIT-012 NS-15 — REST surface for building-spaces module.
//
// Routes (all under global /v1 prefix):
//   GET    /v1/buildings/:slug/spaces
//   POST   /v1/buildings/:slug/spaces
//   PATCH  /v1/buildings/:slug/spaces/:spaceId
//   DELETE /v1/buildings/:slug/spaces/:spaceId
//   GET    /v1/buildings/:slug/elements
//   POST   /v1/buildings/:slug/elements
//   PATCH  /v1/buildings/:slug/elements/:elementId
//   DELETE /v1/buildings/:slug/elements/:elementId
//
// :slug accepts either a building uuid or its tenant-scoped slug (the
// shared resolveBuildingId helper handles both).

import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { resolveTenantId } from '../../common/tenant.utils';
import { AuthService } from '../auth/auth.service';
import { BuildingSpacesService } from './building-spaces.service';

async function userId(auth: string | undefined, s: AuthService): Promise<string> {
  if (!auth || !auth.startsWith('Bearer ')) throw new UnauthorizedException('no token');
  const p = await s.verifySession(auth.slice(7));
  if (!p) throw new UnauthorizedException('invalid or revoked token');
  return p.sub;
}

@Controller('buildings/:slug')
export class BuildingSpacesController {
  constructor(
    private readonly svc: BuildingSpacesService,
    private readonly auth: AuthService,
  ) {}

  // ── Spaces ──────────────────────────────────────────
  @Get('spaces')
  async listSpaces(@Param('slug') slug: string, @Headers('x-tenant-id') th?: string) {
    return this.svc.listSpaces(resolveTenantId(th), slug);
  }

  @Post('spaces')
  async createSpace(
    @Param('slug') slug: string,
    @Body() body: any,
    @Headers('x-tenant-id') th?: string,
    @Headers('authorization') ah?: string,
  ) {
    return this.svc.createSpace(resolveTenantId(th), await userId(ah, this.auth), slug, body);
  }

  @Patch('spaces/:spaceId')
  async patchSpace(
    @Param('slug') slug: string,
    @Param('spaceId') spaceId: string,
    @Body() body: any,
    @Headers('x-tenant-id') th?: string,
    @Headers('authorization') ah?: string,
  ) {
    return this.svc.updateSpace(
      resolveTenantId(th),
      await userId(ah, this.auth),
      slug,
      spaceId,
      body,
    );
  }

  @Delete('spaces/:spaceId')
  async deleteSpace(
    @Param('slug') slug: string,
    @Param('spaceId') spaceId: string,
    @Headers('x-tenant-id') th?: string,
    @Headers('authorization') ah?: string,
  ) {
    return this.svc.deleteSpace(resolveTenantId(th), await userId(ah, this.auth), slug, spaceId);
  }

  // ── Elements ────────────────────────────────────────
  @Get('elements')
  async listElements(@Param('slug') slug: string, @Headers('x-tenant-id') th?: string) {
    return this.svc.listElements(resolveTenantId(th), slug);
  }

  @Post('elements')
  async createElement(
    @Param('slug') slug: string,
    @Body() body: any,
    @Headers('x-tenant-id') th?: string,
    @Headers('authorization') ah?: string,
  ) {
    return this.svc.createElement(resolveTenantId(th), await userId(ah, this.auth), slug, body);
  }

  @Patch('elements/:elementId')
  async patchElement(
    @Param('slug') slug: string,
    @Param('elementId') elementId: string,
    @Body() body: any,
    @Headers('x-tenant-id') th?: string,
    @Headers('authorization') ah?: string,
  ) {
    return this.svc.updateElement(
      resolveTenantId(th),
      await userId(ah, this.auth),
      slug,
      elementId,
      body,
    );
  }

  @Delete('elements/:elementId')
  async deleteElement(
    @Param('slug') slug: string,
    @Param('elementId') elementId: string,
    @Headers('x-tenant-id') th?: string,
    @Headers('authorization') ah?: string,
  ) {
    return this.svc.deleteElement(
      resolveTenantId(th),
      await userId(ah, this.auth),
      slug,
      elementId,
    );
  }
}
