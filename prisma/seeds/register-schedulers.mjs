import { Queue } from 'bullmq';

const connection = {
  url: process.env.REDIS_URL || 'redis://localhost:6379',
};

const queue = new Queue('domera-schedulers', { connection });

async function run() {
  await queue.upsertJobScheduler('nt01-task-recurrence-materializer', { pattern: '0 5 0 * * *' });
  await queue.upsertJobScheduler('nt01-overdue-escalator', { pattern: '0 0 * * * *' });
  await queue.upsertJobScheduler('nt01-document-expiry-check', { pattern: '0 20 1 * * *' });
  await queue.upsertJobScheduler('nt01-budget-rollup', { pattern: '0 35 0 * * *' });

  console.log('[worker] schedulers upserted');
  await queue.close();
}

run().catch((err) => {
  console.error('[worker] failed', err);
  process.exit(1);
});
