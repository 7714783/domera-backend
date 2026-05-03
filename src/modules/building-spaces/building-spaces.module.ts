import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BuildingSpacesController } from './building-spaces.controller';
import { BuildingSpacesService } from './building-spaces.service';

@Module({
  imports: [AuthModule],
  controllers: [BuildingSpacesController],
  providers: [BuildingSpacesService],
  exports: [BuildingSpacesService],
})
export class BuildingSpacesModule {}
