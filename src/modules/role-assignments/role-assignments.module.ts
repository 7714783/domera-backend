import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RoleAssignmentsController } from './role-assignments.controller';
import { RoleAssignmentsService } from './role-assignments.service';

// @Global so PPM/Cleaning/Reactive can inject `RoleAssignmentsService`
// to call findEligibleAssignees without listing the module in their
// imports[].
@Global()
@Module({
  imports: [AuthModule],
  controllers: [RoleAssignmentsController],
  providers: [RoleAssignmentsService],
  exports: [RoleAssignmentsService],
})
export class RoleAssignmentsModule {}
