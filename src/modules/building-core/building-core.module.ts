import { Module, forwardRef } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AssetsModule } from '../assets/assets.module';
import { BuildingCoreController } from './building-core.controller';
import { BuildingCoreService } from './building-core.service';

@Module({
  imports: [AuthModule, forwardRef(() => AssetsModule)],
  controllers: [BuildingCoreController],
  providers: [BuildingCoreService],
  exports: [BuildingCoreService],
})
export class BuildingCoreModule {}
