import { Controller, Get, Headers, Query } from '@nestjs/common';
import { resolveTenantId } from '../../common/tenant.utils';
import { EventsService } from './events.service';

@Controller('events')
export class EventsController {
  constructor(private readonly svc: EventsService) {}

  @Get()
  list(
    @Query('status') status?: string,
    @Query('type') type?: string,
    @Query('take') take?: string,
    @Headers('x-tenant-id') th?: string,
  ) {
    return this.svc.list(resolveTenantId(th), {
      status,
      type,
      take: take ? Number(take) : undefined,
    });
  }
}
