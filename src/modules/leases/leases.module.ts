import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BuildingsModule } from '../buildings/buildings.module';
import { LeasesController } from './leases.controller';
import { LeasesService } from './leases.service';

@Module({
  imports: [AuthModule, BuildingsModule],
  controllers: [LeasesController],
  providers: [LeasesService],
  exports: [LeasesService],
})
export class LeasesModule {}
