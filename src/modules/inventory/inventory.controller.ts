import {
  Body,
  Controller,
  Get,
  Headers,
  Post,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { resolveTenantId } from '../../common/tenant.utils';
import { AuthService } from '../auth/auth.service';
import { InventoryService } from './inventory.service';

async function uid(auth: string | undefined, s: AuthService): Promise<string> {
  if (!auth || !auth.startsWith('Bearer ')) throw new UnauthorizedException('no token');
  const p = await s.verifySession(auth.slice(7));
  if (!p) throw new UnauthorizedException('invalid or revoked token');
  return p.sub;
}

@Controller('inventory')
export class InventoryController {
  constructor(
    private readonly inv: InventoryService,
    private readonly auth: AuthService,
  ) {}

  @Get('items')
  listItems(@Headers('x-tenant-id') th?: string) {
    return this.inv.listItems(resolveTenantId(th));
  }

  @Post('items')
  async upsertItem(
    @Body() body: any,
    @Headers('x-tenant-id') th?: string,
    @Headers('authorization') ah?: string,
  ) {
    await uid(ah, this.auth);
    return this.inv.upsertItem(resolveTenantId(th), body);
  }

  @Get('locations')
  listLocations(@Headers('x-tenant-id') th?: string) {
    return this.inv.listLocations(resolveTenantId(th));
  }

  @Post('locations')
  async upsertLocation(
    @Body() body: any,
    @Headers('x-tenant-id') th?: string,
    @Headers('authorization') ah?: string,
  ) {
    await uid(ah, this.auth);
    return this.inv.upsertLocation(resolveTenantId(th), body);
  }

  @Get('balances')
  balance(
    @Query('itemId') itemId?: string,
    @Query('locationId') locationId?: string,
    @Headers('x-tenant-id') th?: string,
  ) {
    return this.inv.balance(resolveTenantId(th), { itemId, locationId });
  }

  @Get('movements')
  listMovements(
    @Query('itemId') itemId?: string,
    @Query('workOrderId') workOrderId?: string,
    @Query('limit') limit?: string,
    @Headers('x-tenant-id') th?: string,
  ) {
    return this.inv.listMovements(resolveTenantId(th), {
      itemId,
      workOrderId,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Post('movements')
  async record(
    @Body() body: any,
    @Headers('x-tenant-id') th?: string,
    @Headers('authorization') ah?: string,
  ) {
    return this.inv.recordMovement(resolveTenantId(th), await uid(ah, this.auth), body);
  }

  @Get('reconciliation')
  reconciliation(@Headers('x-tenant-id') th?: string) {
    return this.inv.reconciliation(resolveTenantId(th));
  }
}
