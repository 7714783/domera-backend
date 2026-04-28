import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { resolveTenantId } from '../../common/tenant.utils';
import { AuthService } from '../auth/auth.service';
import { DocumentTemplatesService } from './document-templates.service';

async function uid(auth: string | undefined, s: AuthService): Promise<string> {
  if (!auth || !auth.startsWith('Bearer ')) throw new UnauthorizedException('no token');
  const p = await s.verifySession(auth.slice(7));
  if (!p) throw new UnauthorizedException('invalid or revoked token');
  return p.sub;
}

@Controller('document-templates')
export class DocumentTemplatesController {
  constructor(
    private readonly svc: DocumentTemplatesService,
    private readonly auth: AuthService,
  ) {}

  @Get()
  list(
    @Query('buildingId') buildingId?: string,
    @Query('kind') kind?: string,
    @Query('includeInactive') includeInactive?: string,
    @Headers('x-tenant-id') th?: string,
  ) {
    return this.svc.list(resolveTenantId(th), {
      buildingId,
      kind,
      includeInactive: includeInactive === '1' || includeInactive === 'true',
    });
  }

  @Get(':id')
  get(@Param('id') id: string, @Headers('x-tenant-id') th?: string) {
    return this.svc.get(resolveTenantId(th), id);
  }

  @Get(':id/applied-to')
  appliedTo(@Param('id') id: string, @Headers('x-tenant-id') th?: string) {
    return this.svc.appliedTo(resolveTenantId(th), id);
  }

  @Post()
  async create(
    @Body() body: any,
    @Headers('x-tenant-id') th?: string,
    @Headers('authorization') ah?: string,
  ) {
    return this.svc.create(resolveTenantId(th), await uid(ah, this.auth), body);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: any, @Headers('x-tenant-id') th?: string) {
    return this.svc.update(resolveTenantId(th), id, body);
  }

  @Delete(':id')
  del(@Param('id') id: string, @Headers('x-tenant-id') th?: string) {
    return this.svc.delete(resolveTenantId(th), id);
  }
}
