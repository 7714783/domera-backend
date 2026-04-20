import { Module, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ApprovalsModule } from '../approvals/approvals.module';
import { PrismaService } from '../../prisma/prisma.service';
import { PpmController } from './ppm.controller';
import { PpmService } from './ppm.service';
import { createSlaReminderInfra, scanAndSendReminders } from './sla-reminder.worker';
import type { Queue, Worker } from 'bullmq';

class PpmSlaReminderRunner implements OnModuleInit, OnModuleDestroy {
  private queue?: Queue;
  private worker?: Worker;
  constructor(private readonly prisma: PrismaService) {}
  async onModuleInit() {
    if (process.env.PPM_SLA_WORKER_ENABLED !== 'true') return;
    const infra = createSlaReminderInfra(this.prisma);
    this.queue = infra.queue;
    this.worker = infra.worker;
  }
  async onModuleDestroy() {
    await this.worker?.close();
    await this.queue?.close();
  }
  runNow() {
    return scanAndSendReminders(this.prisma);
  }
}

@Module({
  imports: [AuthModule, ApprovalsModule],
  controllers: [PpmController],
  providers: [PpmService, PpmSlaReminderRunner],
  exports: [PpmService, PpmSlaReminderRunner],
})
export class PpmModule {}
