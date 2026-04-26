import { Module } from '@nestjs/common';
import { AssignmentModule } from '../assignment/assignment.module';
import { PublicQrController } from './public-qr.controller';
import { PublicQrService } from './public-qr.service';

@Module({
  imports: [AssignmentModule],
  controllers: [PublicQrController],
  providers: [PublicQrService],
  exports: [PublicQrService],
})
export class PublicQrModule {}
