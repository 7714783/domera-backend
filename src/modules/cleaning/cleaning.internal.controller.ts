import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { Response } from 'express';
import { resolveTenantId } from '../../common/tenant.utils';
import { AuthService } from '../auth/auth.service';
import { CleaningAccessService } from './cleaning.access.service';
import { CleaningRequestService } from './cleaning.request.service';
import { CleaningAdminService } from './cleaning.admin.service';
import { CleaningQrService } from './cleaning.qr.service';

async function uid(auth: string | undefined, s: AuthService): Promise<string> {
  if (!auth || !auth.startsWith('Bearer ')) throw new UnauthorizedException('no token');
  const p = await s.verifySession(auth.slice(7));
  if (!p) throw new UnauthorizedException('invalid or revoked token');
  return p.sub;
}

@Controller('cleaning')
export class CleaningInternalController {
  constructor(
    private readonly auth: AuthService,
    private readonly access: CleaningAccessService,
    private readonly reqSvc: CleaningRequestService,
    private readonly admin: CleaningAdminService,
    private readonly qr: CleaningQrService,
  ) {}

  // ── Requests ───────────────────────────────────────────
  @Get('requests')
  async listRequests(
    @Query('status') status?: string,
    @Query('priority') priority?: string,
    @Query('contractorId') contractorId?: string,
    @Query('zoneId') zoneId?: string,
    @Query('source') source?: string,
    @Query('buildingId') buildingId?: string,
    @Query('take') take?: string,
    @Query('skip') skip?: string,
    @Headers('x-tenant-id') th?: string,
    @Headers('authorization') ah?: string,
  ) {
    const tenantId = resolveTenantId(th);
    const actor = await this.access.resolve(tenantId, await uid(ah, this.auth));
    return this.reqSvc.list(actor, {
      status,
      priority,
      contractorId,
      zoneId,
      source,
      buildingId,
      take: take ? Number(take) : undefined,
      skip: skip ? Number(skip) : undefined,
    });
  }

  @Get('requests/:id')
  async getRequest(
    @Param('id') id: string,
    @Headers('x-tenant-id') th?: string,
    @Headers('authorization') ah?: string,
  ) {
    const tenantId = resolveTenantId(th);
    const actor = await this.access.resolve(tenantId, await uid(ah, this.auth));
    return this.reqSvc.get(actor, id);
  }

  @Post('requests')
  async createRequest(
    @Body() body: any,
    @Headers('x-tenant-id') th?: string,
    @Headers('authorization') ah?: string,
  ) {
    const tenantId = resolveTenantId(th);
    const actor = await this.access.resolve(tenantId, await uid(ah, this.auth));
    return this.reqSvc.internalCreate(actor, body);
  }

  @Patch('requests/:id/status')
  async patchStatus(
    @Param('id') id: string,
    @Body() body: { status: string },
    @Headers('x-tenant-id') th?: string,
    @Headers('authorization') ah?: string,
  ) {
    const tenantId = resolveTenantId(th);
    const actor = await this.access.resolve(tenantId, await uid(ah, this.auth));
    return this.reqSvc.changeStatus(actor, id, body.status);
  }

  @Patch('requests/:id/assign')
  async assign(
    @Param('id') id: string,
    @Body() body: { contractorId?: string; assignedStaffId?: string },
    @Headers('x-tenant-id') th?: string,
    @Headers('authorization') ah?: string,
  ) {
    const tenantId = resolveTenantId(th);
    const actor = await this.access.resolve(tenantId, await uid(ah, this.auth));
    return this.reqSvc.assign(actor, id, body);
  }

  @Post('requests/:id/comments')
  async comment(
    @Param('id') id: string,
    @Body() body: { body: string; isInternal?: boolean },
    @Headers('x-tenant-id') th?: string,
    @Headers('authorization') ah?: string,
  ) {
    const tenantId = resolveTenantId(th);
    const actor = await this.access.resolve(tenantId, await uid(ah, this.auth));
    return this.reqSvc.addComment(actor, id, body);
  }

  // ── Contractors ────────────────────────────────────────
  @Get('contractors')
  async listContractors(
    @Query('buildingId') buildingId?: string,
    @Headers('x-tenant-id') th?: string,
    @Headers('authorization') ah?: string,
  ) {
    const tenantId = resolveTenantId(th);
    const actor = await this.access.resolve(tenantId, await uid(ah, this.auth));
    return this.admin.listContractors(actor, buildingId);
  }

  @Post('contractors')
  async createContractor(
    @Body() body: any,
    @Headers('x-tenant-id') th?: string,
    @Headers('authorization') ah?: string,
  ) {
    const tenantId = resolveTenantId(th);
    const actor = await this.access.resolve(tenantId, await uid(ah, this.auth));
    return this.admin.createContractor(actor, body);
  }

  @Get('contractors/:id/staff')
  async listStaff(
    @Param('id') id: string,
    @Headers('x-tenant-id') th?: string,
    @Headers('authorization') ah?: string,
  ) {
    const tenantId = resolveTenantId(th);
    const actor = await this.access.resolve(tenantId, await uid(ah, this.auth));
    return this.admin.listStaff(actor, id);
  }

  @Post('contractors/:id/staff')
  async createStaff(
    @Param('id') id: string,
    @Body() body: any,
    @Headers('x-tenant-id') th?: string,
    @Headers('authorization') ah?: string,
  ) {
    const tenantId = resolveTenantId(th);
    const actor = await this.access.resolve(tenantId, await uid(ah, this.auth));
    return this.admin.createStaff(actor, { ...body, contractorId: id });
  }

  // ── Zones ──────────────────────────────────────────────
  @Get('zones')
  async listZones(
    @Query('buildingId') buildingId?: string,
    @Headers('x-tenant-id') th?: string,
    @Headers('authorization') ah?: string,
  ) {
    const tenantId = resolveTenantId(th);
    const actor = await this.access.resolve(tenantId, await uid(ah, this.auth));
    return this.admin.listZones(actor, buildingId);
  }

  @Post('zones')
  async createZone(
    @Body() body: any,
    @Headers('x-tenant-id') th?: string,
    @Headers('authorization') ah?: string,
  ) {
    const tenantId = resolveTenantId(th);
    const actor = await this.access.resolve(tenantId, await uid(ah, this.auth));
    return this.admin.createZone(actor, body);
  }

  @Patch('zones/:id/assignment')
  async assignZone(
    @Param('id') id: string,
    @Body() body: any,
    @Headers('x-tenant-id') th?: string,
    @Headers('authorization') ah?: string,
  ) {
    const tenantId = resolveTenantId(th);
    const actor = await this.access.resolve(tenantId, await uid(ah, this.auth));
    return this.admin.assignZone(actor, id, body);
  }

  // ── QR points ──────────────────────────────────────────
  @Get('qr-points')
  async listQr(
    @Query('buildingId') buildingId?: string,
    @Headers('x-tenant-id') th?: string,
    @Headers('authorization') ah?: string,
  ) {
    const tenantId = resolveTenantId(th);
    await this.access.resolve(tenantId, await uid(ah, this.auth));
    return this.qr.list(tenantId, buildingId);
  }

  @Get('qr-locations')
  async listQrLocations(
    @Query('buildingId') buildingId: string,
    @Headers('x-tenant-id') th?: string,
    @Headers('authorization') ah?: string,
  ) {
    if (!buildingId) throw new BadRequestException('buildingId query param required');
    const tenantId = resolveTenantId(th);
    await this.access.resolve(tenantId, await uid(ah, this.auth));
    return this.qr.listLocations(tenantId, buildingId);
  }

  @Post('qr-points')
  async createQr(
    @Body() body: any,
    @Headers('x-tenant-id') th?: string,
    @Headers('authorization') ah?: string,
  ) {
    const tenantId = resolveTenantId(th);
    await this.access.resolve(tenantId, await uid(ah, this.auth));
    return this.qr.create(tenantId, body);
  }

  @Get('qr-points/:id/image')
  async renderQrImage(
    @Param('id') id: string,
    @Res() res: Response,
    @Query('format') format?: string,
    @Query('size') size?: string,
    @Query('download') download?: string,
    @Headers('x-tenant-id') th?: string,
    @Headers('authorization') ah?: string,
  ) {
    const tenantId = resolveTenantId(th);
    await this.access.resolve(tenantId, await uid(ah, this.auth));
    const out = await this.qr.renderImage(tenantId, id, {
      format: format === 'png' ? 'png' : 'svg',
      size: size ? Number(size) : undefined,
    });
    res.setHeader('Content-Type', out.mime);
    res.setHeader('Cache-Control', 'private, max-age=300');
    if (download === '1' || download === 'true') {
      res.setHeader('Content-Disposition', `attachment; filename="${out.filename}"`);
    }
    res.send(out.body);
  }
}
