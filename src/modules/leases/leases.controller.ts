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
import { LeasesService } from './leases.service';

async function uid(auth: string | undefined, s: AuthService): Promise<string> {
  if (!auth || !auth.startsWith('Bearer ')) throw new UnauthorizedException('no token');
  const p = await s.verifySession(auth.slice(7));
  if (!p) throw new UnauthorizedException('invalid or revoked token');
  return p.sub;
}

@Controller()
export class LeasesController {
  constructor(
    private readonly svc: LeasesService,
    private readonly auth: AuthService,
  ) {}

  // ─── Contract escalation + insurance ─────────────────────────
  @Patch('contracts/:id/escalation')
  async setEscalation(
    @Param('id') id: string,
    @Body() body: { policy: any },
    @Headers('x-tenant-id') th?: string,
    @Headers('authorization') ah?: string,
  ) {
    await uid(ah, this.auth);
    return this.svc.setEscalationPolicy(resolveTenantId(th), id, body?.policy);
  }

  @Patch('contracts/:id/insurance')
  async setInsurance(
    @Param('id') id: string,
    @Body() body: { documentId: string | null },
    @Headers('x-tenant-id') th?: string,
    @Headers('authorization') ah?: string,
  ) {
    await uid(ah, this.auth);
    return this.svc.setInsuranceDocument(resolveTenantId(th), id, body?.documentId ?? null);
  }

  // ─── Allocations ─────────────────────────────────────────────
  @Get('contracts/:id/allocations')
  list(@Param('id') id: string, @Headers('x-tenant-id') th?: string) {
    return this.svc.listAllocations(resolveTenantId(th), id);
  }

  @Post('contracts/:id/allocations')
  async add(
    @Param('id') id: string,
    @Body() body: any,
    @Headers('x-tenant-id') th?: string,
    @Headers('authorization') ah?: string,
  ) {
    await uid(ah, this.auth);
    return this.svc.addAllocation(resolveTenantId(th), id, body);
  }

  @Delete('lease-allocations/:allocationId')
  async remove(
    @Param('allocationId') allocationId: string,
    @Headers('x-tenant-id') th?: string,
    @Headers('authorization') ah?: string,
  ) {
    await uid(ah, this.auth);
    return this.svc.removeAllocation(resolveTenantId(th), allocationId);
  }

  // ─── Expiring documents (insurance / KYC) ────────────────────
  @Get('documents/expiring')
  expiring(
    @Query('withinDays') withinDays?: string,
    @Query('documentTypeKey') documentTypeKey?: string,
    @Headers('x-tenant-id') th?: string,
  ) {
    return this.svc.expiringDocuments(resolveTenantId(th), {
      withinDays: withinDays ? Number(withinDays) : undefined,
      documentTypeKey,
    });
  }

  @Patch('documents/:id/expiry')
  async setExpiry(
    @Param('id') id: string,
    @Body() body: { expiresAt: string | null },
    @Headers('x-tenant-id') th?: string,
    @Headers('authorization') ah?: string,
  ) {
    await uid(ah, this.auth);
    return this.svc.setDocumentExpiry(resolveTenantId(th), id, body?.expiresAt ?? null);
  }
}
