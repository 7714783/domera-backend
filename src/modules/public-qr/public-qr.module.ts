import { Module } from '@nestjs/common';
import { PublicQrController } from './public-qr.controller';
import { PublicQrService } from './public-qr.service';

@Module({
  controllers: [PublicQrController],
  providers: [PublicQrService],
  exports: [PublicQrService],
})
export class PublicQrModule {}
