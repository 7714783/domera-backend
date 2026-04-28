import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Post,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { resolveTenantId } from '../../common/tenant.utils';
import { AuthService } from '../auth/auth.service';
import { DocumentLinksService } from './document-links.service';

async function uid(auth: string | undefined, s: AuthService): Promise<string> {
  if (!auth || !auth.startsWith('Bearer ')) throw new UnauthorizedException('no token');
  const p = await s.verifySession(auth.slice(7));
  if (!p) throw new UnauthorizedException('invalid or revoked token');
  return p.sub;
}

@Controller('document-links')
export class DocumentLinksController {
  constructor(
    private readonly svc: DocumentLinksService,
    private readonly auth: AuthService,
  ) {}

  @Get()
  list(
    @Headers('x-tenant-id') th: string | undefined,
    @Query('targetType') targetType?: string,
    @Query('targetId') targetId?: string,
    @Query('documentId') documentId?: string,
  ) {
    const tenantId = resolveTenantId(th);
    if (documentId) return this.svc.listForDocument(tenantId, documentId);
    if (targetType && targetId) return this.svc.listForTarget(tenantId, targetType, targetId);
    return [];
  }

  @Post()
  async create(
    @Body() body: { documentId: string; targetType: string; targetId: string },
    @Headers('x-tenant-id') th?: string,
    @Headers('authorization') ah?: string,
  ) {
    return this.svc.create(resolveTenantId(th), await uid(ah, this.auth), body);
  }

  @Delete(':id')
  del(@Param('id') id: string, @Headers('x-tenant-id') th?: string) {
    return this.svc.delete(resolveTenantId(th), id);
  }
}
