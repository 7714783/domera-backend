import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { resolveTenantId } from '../../common/tenant.utils';
import { AuthService } from '../auth/auth.service';
import { PrivacyService } from './privacy.service';

async function uid(auth: string | undefined, s: AuthService): Promise<string> {
  if (!auth || !auth.startsWith('Bearer ')) throw new UnauthorizedException('no token');
  const p = await s.verifySession(auth.slice(7));
  if (!p) throw new UnauthorizedException('invalid or revoked token');
  return p.sub;
}

@Controller('privacy')
export class PrivacyController {
  constructor(
    private readonly svc: PrivacyService,
    private readonly auth: AuthService,
  ) {}

  @Get('categories')
  listCategories(@Headers('x-tenant-id') th?: string) {
    return this.svc.listCategories(resolveTenantId(th));
  }

  @Post('categories')
  async upsertCategory(
    @Body() body: any,
    @Headers('x-tenant-id') th?: string,
    @Headers('authorization') ah?: string,
  ) {
    return this.svc.upsertCategory(resolveTenantId(th), await uid(ah, this.auth), body);
  }

  @Post('categories/seed-built-ins')
  async seedBuiltIns(@Headers('x-tenant-id') th?: string, @Headers('authorization') ah?: string) {
    return this.svc.seedBuiltIns(resolveTenantId(th), await uid(ah, this.auth));
  }

  @Get('ropa')
  ropa(@Headers('x-tenant-id') th?: string) {
    return this.svc.ropa(resolveTenantId(th));
  }

  // DSAR
  @Post('dsar')
  createDsar(@Body() body: any, @Headers('x-tenant-id') th?: string) {
    return this.svc.createDsar(resolveTenantId(th), body);
  }

  @Get('dsar')
  listDsar(@Query('status') status?: string, @Headers('x-tenant-id') th?: string) {
    return this.svc.listDsar(resolveTenantId(th), status);
  }

  @Post('dsar/:id/process')
  async processDsar(
    @Param('id') id: string,
    @Headers('x-tenant-id') th?: string,
    @Headers('authorization') ah?: string,
  ) {
    return this.svc.processDsar(resolveTenantId(th), await uid(ah, this.auth), id);
  }

  // ─── Subprocessor registry ───────────────────────────────────
  @Get('subprocessors')
  listSubprocessors(
    @Query('status') status?: string,
    @Query('category') category?: string,
    @Headers('x-tenant-id') th?: string,
  ) {
    return this.svc.listSubprocessors(resolveTenantId(th), { status, category });
  }

  @Post('subprocessors')
  async upsertSubprocessor(
    @Body() body: any,
    @Headers('x-tenant-id') th?: string,
    @Headers('authorization') ah?: string,
  ) {
    return this.svc.upsertSubprocessor(resolveTenantId(th), await uid(ah, this.auth), body);
  }

  @Post('subprocessors/:id/approve')
  async approveSubprocessor(
    @Param('id') id: string,
    @Headers('x-tenant-id') th?: string,
    @Headers('authorization') ah?: string,
  ) {
    return this.svc.approveSubprocessor(resolveTenantId(th), await uid(ah, this.auth), id);
  }

  @Post('subprocessors/:id/retire')
  async retireSubprocessor(
    @Param('id') id: string,
    @Headers('x-tenant-id') th?: string,
    @Headers('authorization') ah?: string,
  ) {
    return this.svc.retireSubprocessor(resolveTenantId(th), await uid(ah, this.auth), id);
  }

  @Post('subprocessors/seed-built-ins')
  async seedSubprocessors(
    @Headers('x-tenant-id') th?: string,
    @Headers('authorization') ah?: string,
  ) {
    return this.svc.seedSubprocessors(resolveTenantId(th), await uid(ah, this.auth));
  }

  // ─── DPA templates ───────────────────────────────────────────
  @Get('dpa-templates')
  listDpaTemplates(
    @Query('jurisdiction') jurisdiction?: string,
    @Query('includeInactive') includeInactive?: string,
    @Headers('x-tenant-id') th?: string,
  ) {
    return this.svc.listDpaTemplates(resolveTenantId(th), {
      jurisdiction,
      includeInactive: includeInactive === '1' || includeInactive === 'true',
    });
  }

  @Post('dpa-templates')
  async createDpaTemplate(
    @Body() body: any,
    @Headers('x-tenant-id') th?: string,
    @Headers('authorization') ah?: string,
  ) {
    return this.svc.createDpaTemplate(resolveTenantId(th), await uid(ah, this.auth), body);
  }

  @Post('dpa-templates/:id/render')
  renderDpaTemplate(
    @Param('id') id: string,
    @Body() body: { values: Record<string, string> },
    @Headers('x-tenant-id') th?: string,
  ) {
    return this.svc.renderDpaTemplate(resolveTenantId(th), id, body?.values || {});
  }

  @Post('dpa-templates/seed-built-ins')
  async seedDpaTemplates(
    @Headers('x-tenant-id') th?: string,
    @Headers('authorization') ah?: string,
  ) {
    return this.svc.seedDpaTemplates(resolveTenantId(th), await uid(ah, this.auth));
  }
}
