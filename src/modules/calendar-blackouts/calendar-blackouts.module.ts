import { Module } from '@nestjs/common';
import { CalendarBlackoutsController } from './calendar-blackouts.controller';
import { CalendarBlackoutsService } from './calendar-blackouts.service';

@Module({
  controllers: [CalendarBlackoutsController],
  providers: [CalendarBlackoutsService],
  exports: [CalendarBlackoutsService],
})
export class CalendarBlackoutsModule {}
