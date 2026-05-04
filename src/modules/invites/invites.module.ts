import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { InvitesController } from './invites.controller';
import { InvitesService } from './invites.service';

// AuditModule + EventsModule are @Global — InvitesService injects
// AuditService + OutboxService directly without listing them here.
@Module({
  imports: [AuthModule],
  controllers: [InvitesController],
  providers: [InvitesService],
  exports: [InvitesService],
})
export class InvitesModule {}
