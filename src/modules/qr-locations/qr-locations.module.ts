import { Module } from '@nestjs/common';
import { PublicQrModule } from '../public-qr/public-qr.module';
import { QrLocationsController } from './qr-locations.controller';
import { QrLocationsService } from './qr-locations.service';

@Module({
  imports: [PublicQrModule],
  controllers: [QrLocationsController],
  providers: [QrLocationsService],
  exports: [QrLocationsService],
})
export class QrLocationsModule {}
