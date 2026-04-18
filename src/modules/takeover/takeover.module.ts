import { Module } from '@nestjs/common';
import { TakeoverController } from './takeover.controller';
import { TakeoverService } from './takeover.service';

@Module({
  controllers: [TakeoverController],
  providers: [TakeoverService],
  exports: [TakeoverService],
})
export class TakeoverModule {}
