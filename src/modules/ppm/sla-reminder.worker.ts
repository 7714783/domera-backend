import { Logger } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { PrismaClient } from '@prisma/client';

const QUEUE_NAME = 'ppm-sla-reminder';
const JOB_NAME = 'scan-sla-reminders';

/**
 * Scans every active PpmPlanItem and, for each element of
 * `template.slaReminderDays` (e.g. [30, 14, 3]), if today falls on
 * `nextDueAt - N days` (± 12h window), create a Notification for:
 *   - the assignedUserId of the plan item (if set)
 *   - every `evidenceRecipient` with a `role` that maps to a building role assignment
 *
 * Notifications are idempotent per (planItemId, dueDate, N) via a deterministic
 * content tag stored in `type` — re-runs on the same day do nothing new.
 */
export async function scanAndSendReminders(prisma: PrismaClient): Promise<{ scanned: number; emitted: number }> {
  const now = Date.now();
  const windowMs = 12 * 60 * 60 * 1000;

  const plans = await prisma.ppmPlanItem.findMany({
    include: { template: { select: { slaReminderDays: true, evidenceRecipients: true, assignedUserId: true, name: true } } },
  });

  let emitted = 0;

  for (const plan of plans) {
    const due = plan.nextDueAt.getTime();
    const reminderDays = plan.template.slaReminderDays || [];
    for (const n of reminderDays) {
      const target = due - n * 86400000;
      if (Math.abs(now - target) > windowMs) continue; // only on the day itself (± half-day)

      const type = `ppm.sla.${plan.id}.${new Date(plan.nextDueAt).toISOString().slice(0, 10)}.d${n}`;
      const already = await prisma.notification.findFirst({ where: { tenantId: plan.tenantId, type } });
      if (already) continue;

      const content = `PPM "${plan.template.name}" is due on ${new Date(plan.nextDueAt).toISOString().slice(0, 10)} — ${n} day(s) ahead.`;
      const recipientUserIds = new Set<string>();
      if (plan.assignedUserId) recipientUserIds.add(plan.assignedUserId);

      const recipients = Array.isArray(plan.template.evidenceRecipients) ? plan.template.evidenceRecipients as Array<{ role?: string; userId?: string }> : [];
      for (const r of recipients) {
        if (r.userId) recipientUserIds.add(r.userId);
        if (r.role) {
          const assigns = await prisma.buildingRoleAssignment.findMany({
            where: { tenantId: plan.tenantId, buildingId: plan.buildingId, roleKey: r.role },
            select: { userId: true },
          });
          for (const a of assigns) recipientUserIds.add(a.userId);
        }
      }

      for (const userId of recipientUserIds) {
        await prisma.notification.create({
          data: { tenantId: plan.tenantId, buildingId: plan.buildingId, userId, type, content },
        });
        emitted++;
      }
    }
  }
  return { scanned: plans.length, emitted };
}

export function createSlaReminderInfra(prisma: PrismaClient) {
  const connection = { url: process.env.REDIS_URL || 'redis://localhost:6379' };
  const logger = new Logger('PpmSlaReminder');
  const queue = new Queue(QUEUE_NAME, { connection });

  // Upsert the daily scheduler. Pattern: 05:30 every day.
  queue.upsertJobScheduler('daily-sla-scan', { pattern: '0 30 5 * * *' }, { name: JOB_NAME, data: {} })
    .then(() => logger.log('scheduler upserted: daily-sla-scan'))
    .catch((err) => logger.error('scheduler upsert failed', err as any));

  const worker = new Worker(
    QUEUE_NAME,
    async () => scanAndSendReminders(prisma),
    { connection },
  );
  worker.on('completed', (job) => logger.log(`completed ${job.id} → ${JSON.stringify(job.returnvalue)}`));
  worker.on('failed', (job, err) => logger.error(`failed ${job?.id}`, err));

  return { queue, worker, runNow: () => scanAndSendReminders(prisma) };
}
