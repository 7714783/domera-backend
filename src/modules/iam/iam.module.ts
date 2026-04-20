import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { IamController } from './iam.controller';
import { IamService } from './iam.service';
import { StaffController } from './staff.controller';

@Module({
  imports: [AuditModule],
  controllers: [IamController, StaffController],
  providers: [IamService],
  exports: [IamService],
})
export class IamModule {}
