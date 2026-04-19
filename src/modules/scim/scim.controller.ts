import { Body, Controller, Delete, Get, Headers, Param, Patch, Post, Put, Query, UnauthorizedException } from '@nestjs/common';
import { resolveTenantId } from '../../common/tenant.utils';
import { AuthService } from '../auth/auth.service';
import { ScimService } from './scim.service';

async function uid(auth: string | undefined, s: AuthService): Promise<string> {
  if (!auth || !auth.startsWith('Bearer ')) throw new UnauthorizedException('no token');
  const p = await s.verifySession(auth.slice(7));
  if (!p) throw new UnauthorizedException('invalid or revoked token');
  return p.sub;
}

@Controller('scim')
export class ScimController {
  constructor(
    private readonly svc: ScimService,
    private readonly auth: AuthService,
  ) {}

  // Admin token management (Domera session required)
  @Get('tokens')
  async listTokens(@Headers('x-tenant-id') th?: string) {
    return this.svc.listTokens(resolveTenantId(th));
  }

  @Post('tokens')
  async createToken(
    @Body() body: { label: string },
    @Headers('x-tenant-id') th?: string, @Headers('authorization') ah?: string,
  ) {
    return this.svc.createToken(resolveTenantId(th), await uid(ah, this.auth), body.label);
  }

  @Delete('tokens/:id')
  revokeToken(@Param('id') id: string, @Headers('x-tenant-id') th?: string) {
    return this.svc.revokeToken(resolveTenantId(th), id);
  }

  // SCIM 2.0 — Bearer auth with SCIM token
  @Get('v2/ServiceProviderConfig')
  spConfig() {
    return {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],
      patch: { supported: true },
      bulk: { supported: false },
      filter: { supported: true, maxResults: 500 },
      changePassword: { supported: false },
      sort: { supported: false },
      etag: { supported: false },
      authenticationSchemes: [{ name: 'OAuth Bearer Token', type: 'oauthbearertoken' }],
    };
  }

  @Get('v2/Users')
  async listUsers(
    @Headers('x-tenant-id') th: string | undefined,
    @Headers('authorization') ah: string | undefined,
    @Query('filter') filter?: string,
    @Query('startIndex') start?: string,
    @Query('count') count?: string,
  ) {
    const tenantId = resolveTenantId(th);
    await this.svc.authenticate(tenantId, ah);
    return this.svc.listUsers(
      tenantId, filter,
      start ? Number(start) : 1,
      count ? Number(count) : 100,
    );
  }

  @Get('v2/Users/:id')
  async getUser(
    @Param('id') id: string,
    @Headers('x-tenant-id') th?: string, @Headers('authorization') ah?: string,
  ) {
    const tenantId = resolveTenantId(th);
    await this.svc.authenticate(tenantId, ah);
    return this.svc.getUser(tenantId, id);
  }

  @Post('v2/Users')
  async createUser(
    @Body() body: any,
    @Headers('x-tenant-id') th?: string, @Headers('authorization') ah?: string,
  ) {
    const tenantId = resolveTenantId(th);
    await this.svc.authenticate(tenantId, ah);
    return this.svc.createUser(tenantId, body);
  }

  @Patch('v2/Users/:id')
  async patchUser(
    @Param('id') id: string, @Body() body: any,
    @Headers('x-tenant-id') th?: string, @Headers('authorization') ah?: string,
  ) {
    const tenantId = resolveTenantId(th);
    await this.svc.authenticate(tenantId, ah);
    return this.svc.patchUser(tenantId, id, body);
  }

  @Put('v2/Users/:id')
  async replaceUser(
    @Param('id') id: string, @Body() body: any,
    @Headers('x-tenant-id') th?: string, @Headers('authorization') ah?: string,
  ) {
    const tenantId = resolveTenantId(th);
    await this.svc.authenticate(tenantId, ah);
    return this.svc.patchUser(tenantId, id, { Operations: [{ value: body }] });
  }

  @Delete('v2/Users/:id')
  async deleteUser(
    @Param('id') id: string,
    @Headers('x-tenant-id') th?: string, @Headers('authorization') ah?: string,
  ) {
    const tenantId = resolveTenantId(th);
    await this.svc.authenticate(tenantId, ah);
    return this.svc.deleteUser(tenantId, id);
  }
}
