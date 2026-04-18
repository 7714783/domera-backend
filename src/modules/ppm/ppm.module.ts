import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PpmController } from './ppm.controller';
import { PpmService } from './ppm.service';

@Module({
  imports: [AuthModule],
  controllers: [PpmController],
  providers: [PpmService],
  exports: [PpmService],
})
export class PpmModule {}
