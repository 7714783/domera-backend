import { Module } from '@nestjs/common';
import { ApplicabilityService } from './applicability.service';
import { ObligationsController } from './obligations.controller';

@Module({
  controllers: [ObligationsController],
  providers: [ApplicabilityService],
  exports: [ApplicabilityService],
})
export class ObligationsModule {}
