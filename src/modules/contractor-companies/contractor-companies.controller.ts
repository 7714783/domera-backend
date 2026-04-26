// INIT-007 Phase 6 — REST surface for ContractorCompany.

import {
  Body,
  Controller,
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
import { ContractorCompaniesService } from './contractor-companies.service';

async function uid(auth: string | undefined, s: AuthService): Promise<string> {
  if (!auth || !auth.startsWith('Bearer ')) throw new UnauthorizedException('no token');
  const p = await s.verifySession(auth.slice(7));
  if (!p) throw new UnauthorizedException('invalid or revoked token');
  return p.sub;
}

@Controller('contractor-companies')
export class ContractorCompaniesController {
  constructor(
    private readonly svc: ContractorCompaniesService,
    private readonly auth: AuthService,
  ) {}

  @Get()
  list(
    @Query('domain') domain?: string,
    @Query('isActive') isActive?: string,
    @Headers('x-tenant-id') th?: string,
  ) {
    return this.svc.list(resolveTenantId(th), { domain, isActive });
  }

  @Get(':id')
  get(@Param('id') id: string, @Headers('x-tenant-id') th?: string) {
    return this.svc.get(resolveTenantId(th), id);
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
  async update(
    @Param('id') id: string,
    @Body() body: any,
    @Headers('x-tenant-id') th?: string,
    @Headers('authorization') ah?: string,
  ) {
    return this.svc.update(resolveTenantId(th), await uid(ah, this.auth), id, body);
  }
}
