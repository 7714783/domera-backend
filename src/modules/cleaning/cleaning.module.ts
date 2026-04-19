import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CleaningAccessService } from './cleaning.access.service';
import { CleaningAdminService } from './cleaning.admin.service';
import { CleaningRequestService } from './cleaning.request.service';
import { CleaningQrService } from './cleaning.qr.service';
import { CleaningInternalController } from './cleaning.internal.controller';
import { CleaningPublicController } from './cleaning.public.controller';

@Module({
  imports: [AuthModule],
  controllers: [CleaningInternalController, CleaningPublicController],
  providers: [
    CleaningAccessService,
    CleaningAdminService,
    CleaningRequestService,
    CleaningQrService,
  ],
  exports: [CleaningAccessService, CleaningRequestService, CleaningQrService],
})
export class CleaningModule {}
