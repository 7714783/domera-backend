import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BuildingCoreController } from './building-core.controller';
import { BuildingCoreService } from './building-core.service';

@Module({
  imports: [AuthModule],
  controllers: [BuildingCoreController],
  providers: [BuildingCoreService],
  exports: [BuildingCoreService],
})
export class BuildingCoreModule {}
