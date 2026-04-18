import { Module } from '@nestjs/common';
import { IamController } from './iam.controller';
import { IamService } from './iam.service';
import { StaffController } from './staff.controller';

@Module({
  controllers: [IamController, StaffController],
  providers: [IamService],
  exports: [IamService],
})
export class IamModule {}
