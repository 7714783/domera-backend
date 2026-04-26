import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AssignmentController } from './assignment.controller';
import { AssignmentResolverService } from './assignment.resolver';
import { AssignmentService } from './assignment.service';

@Module({
  imports: [AuthModule],
  controllers: [AssignmentController],
  providers: [AssignmentResolverService, AssignmentService],
  exports: [AssignmentResolverService, AssignmentService],
})
export class AssignmentModule {}
