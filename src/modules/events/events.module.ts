import { Global, Module } from '@nestjs/common';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';
import { OutboxService } from './outbox.service';
import { OutboxRegistry } from './outbox.registry';
import { OutboxDispatcher } from './outbox.dispatcher';

// @Global so any module can `inject OutboxService` without listing
// EventsModule in its imports[]. The dispatcher is started by Nest at
// module-init via OnModuleInit.
@Global()
@Module({
  controllers: [EventsController],
  providers: [EventsService, OutboxService, OutboxRegistry, OutboxDispatcher],
  exports: [EventsService, OutboxService, OutboxRegistry],
})
export class EventsModule {}
