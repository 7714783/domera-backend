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
import { Tenant } from '../../common/tenant.decorator';
import { AuthService } from '../auth/auth.service';
import {
  ContractorsPublicService,
  type PublicContractorCreate,
} from './contractors-public.service';

async function uid(auth: string | undefined, s: AuthService): Promise<string> {
  if (!auth || !auth.startsWith('Bearer ')) throw new UnauthorizedException('no token');
  const p = await s.verifySession(auth.slice(7));
  if (!p) throw new UnauthorizedException('invalid or revoked token');
  return p.sub;
}

// INIT-013 — global PublicContractor catalogue. Read-only for any
// authenticated user; writes for any authenticated user (self-attested),
// platform_verified flag flipped by super-admin only.
@Controller('public-contractors')
export class ContractorsPublicController {
  constructor(
    private readonly svc: ContractorsPublicService,
    private readonly auth: AuthService,
  ) {}

  @Get()
  async list(
    @Query('search') search?: string,
    @Query('limit') limit?: string,
    @Headers('authorization') authHeader?: string,
  ) {
    await uid(authHeader, this.auth);
    return this.svc.list({ search, limit: limit ? Number(limit) : undefined });
  }

  @Get(':id')
  async getOne(@Param('id') id: string, @Headers('authorization') authHeader?: string) {
    await uid(authHeader, this.auth);
    return this.svc.getOne(id);
  }

  @Post()
  async create(
    @Tenant() tenantId: string,
    @Body() body: PublicContractorCreate,
    @Headers('authorization') authHeader?: string,
  ) {
    await uid(authHeader, this.auth);
    return this.svc.create(tenantId, body);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() body: Partial<PublicContractorCreate>,
    @Headers('authorization') authHeader?: string,
  ) {
    await uid(authHeader, this.auth);
    return this.svc.update(id, body);
  }
}
