import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { resolveTenantId } from '../../common/tenant.utils';
import { AuthService } from '../auth/auth.service';
import { DocumentsService } from './documents.service';

async function uid(auth: string | undefined, s: AuthService): Promise<string> {
  if (!auth || !auth.startsWith('Bearer ')) throw new UnauthorizedException('no token');
  const p = await s.verifySession(auth.slice(7));
  if (!p) throw new UnauthorizedException('invalid or revoked token');
  return p.sub;
}

function readStream(req: any): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

@Controller('documents')
export class DocumentsController {
  constructor(
    private readonly svc: DocumentsService,
    private readonly auth: AuthService,
  ) {}

  @Post('upload')
  async upload(
    @Req() req: any,
    @Headers('x-tenant-id') th?: string,
    @Headers('authorization') ah?: string,
    @Headers('x-building-id') buildingIdHeader?: string,
    @Headers('x-title') titleHeader?: string,
    @Headers('x-document-type') docTypeHeader?: string,
    @Headers('x-document-type-key') docTypeKeyHeader?: string,
    @Headers('content-type') contentType?: string,
    @Headers('x-retention-class') retentionHeader?: string,
    @Headers('x-summary') summaryHeader?: string,
  ) {
    const tenantId = resolveTenantId(th);
    const actorUserId = await uid(ah, this.auth);
    if (!buildingIdHeader) throw new BadRequestException('x-building-id header required');
    if (!titleHeader) throw new BadRequestException('x-title header required');
    if (!docTypeHeader) throw new BadRequestException('x-document-type header required');
    const buf: Buffer = req.rawBody || (await readStream(req));
    return this.svc.upload(tenantId, actorUserId, buildingIdHeader, {
      title: titleHeader,
      documentType: docTypeHeader,
      documentTypeKey: docTypeKeyHeader,
      mimeType: contentType,
      retentionClass: retentionHeader,
      summary: summaryHeader,
      buf,
    });
  }

  @Get()
  search(
    @Query('q') q?: string,
    @Query('legalHoldOnly') legalHold?: string,
    @Query('retentionClass') retentionClass?: string,
    @Query('take') take?: string,
    @Query('skip') skip?: string,
    @Headers('x-tenant-id') th?: string,
  ) {
    return this.svc.search(resolveTenantId(th), {
      q,
      legalHoldOnly: legalHold === '1' || legalHold === 'true',
      retentionClass,
      take: take ? Number(take) : undefined,
      skip: skip ? Number(skip) : undefined,
    });
  }

  @Post(':id/legal-hold')
  async setLegalHold(
    @Param('id') id: string,
    @Body() body: { on: boolean; reason?: string },
    @Headers('x-tenant-id') th?: string,
    @Headers('authorization') ah?: string,
  ) {
    return this.svc.setLegalHold(
      resolveTenantId(th),
      await uid(ah, this.auth),
      id,
      !!body.on,
      body.reason,
    );
  }

  @Post(':id/virus-scan')
  recordScan(
    @Param('id') id: string,
    @Body() body: { status: 'clean' | 'infected' | 'unscanned' },
    @Headers('x-tenant-id') th?: string,
  ) {
    if (!['clean', 'infected', 'unscanned'].includes(body.status)) {
      throw new BadRequestException('status must be clean|infected|unscanned');
    }
    return this.svc.recordVirusScan(resolveTenantId(th), id, body.status);
  }

  @Delete(':id')
  del(@Param('id') id: string, @Headers('x-tenant-id') th?: string) {
    return this.svc.delete(resolveTenantId(th), id);
  }

  @Post(':id/signed-url')
  async signedUrl(
    @Param('id') id: string,
    @Body() body: { ttlSeconds?: number } | undefined,
    @Headers('x-tenant-id') th?: string,
    @Headers('authorization') ah?: string,
  ) {
    return this.svc.issueSignedUrl(
      resolveTenantId(th),
      await uid(ah, this.auth),
      id,
      body?.ttlSeconds || 300,
    );
  }
}

@Controller('documents/signed')
export class DocumentsSignedController {
  constructor(private readonly svc: DocumentsService) {}

  @Get(':token')
  async redeem(
    @Param('token') token: string,
    @Req() _req: any,
    @Res({ passthrough: false } as any) res: any,
  ) {
    const r = await this.svc.redeemSignedUrl(token);
    res.setHeader('Content-Type', r.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${r.title.replace(/[^\w.-]+/g, '_')}"`);
    res.end(r.body);
  }
}
