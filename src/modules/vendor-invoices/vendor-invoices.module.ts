import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { VendorInvoicesController } from './vendor-invoices.controller';
import { VendorInvoicesService } from './vendor-invoices.service';

@Module({
  imports: [AuthModule],
  controllers: [VendorInvoicesController],
  providers: [VendorInvoicesService],
  exports: [VendorInvoicesService],
})
export class VendorInvoicesModule {}
