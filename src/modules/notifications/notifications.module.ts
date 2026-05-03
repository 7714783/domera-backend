import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NotificationsController, MailInboundController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { InboundEmailService } from './inbound-email.service';
import { RecipientResolverService } from './recipient-resolver.service';
import { DeliveryDispatcher } from './delivery.dispatcher';
import { NotificationsSubscribers } from './notifications.subscribers';
import { MAILER } from './mailer.token';
import { buildMailerFromEnv } from './mailer.adapter';

@Global()
@Module({
  imports: [AuthModule],
  controllers: [NotificationsController, MailInboundController],
  providers: [
    NotificationsService,
    InboundEmailService,
    RecipientResolverService,
    DeliveryDispatcher,
    NotificationsSubscribers,
    {
      provide: MAILER,
      useFactory: () => buildMailerFromEnv(process.env),
    },
  ],
  exports: [NotificationsService, RecipientResolverService, MAILER],
})
export class NotificationsModule {}
