// PERF-001 Stage 1 — Prisma query timing collector.
//
// Lives outside Nest's DI graph so it can be read by the metrics
// controller without creating a circular dep (PrismaService is in
// PrismaModule, MetricsService is in MetricsModule, and PrismaService
// is constructed before MetricsService is wired up).
//
// Records (model, operation) → count + sumMs + bucketed histogram so
// /metrics can render real Prometheus-shaped data and scripts/baselines
// can compute p50/p95/p99 from the samples by reading bucket counts.

const BUCKETS_MS = [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000];

type Series = {
  count: number;
  sumMs: number;
  buckets: number[];
};

const series = new Map<string, Series>();

function ensure(model: string, operation: string): Series {
  const key = `${model}::${operation}`;
  let s = series.get(key);
  if (!s) {
    s = { count: 0, sumMs: 0, buckets: BUCKETS_MS.map(() => 0) };
    series.set(key, s);
  }
  return s;
}

export function recordQueryTiming(model: string, operation: string, ms: number): void {
  const s = ensure(model, operation);
  s.count += 1;
  s.sumMs += ms;
  for (let i = 0; i < BUCKETS_MS.length; i++) {
    if (ms <= BUCKETS_MS[i]) s.buckets[i] += 1;
  }
}

export function snapshotPrismaStats(): Array<{
  model: string;
  operation: string;
  count: number;
  sumMs: number;
  buckets: Record<string, number>;
}> {
  const out: Array<{
    model: string;
    operation: string;
    count: number;
    sumMs: number;
    buckets: Record<string, number>;
  }> = [];
  for (const [key, s] of series) {
    const [model, operation] = key.split('::');
    const buckets: Record<string, number> = {};
    BUCKETS_MS.forEach((b, i) => {
      buckets[String(b)] = s.buckets[i];
    });
    out.push({ model, operation, count: s.count, sumMs: s.sumMs, buckets });
  }
  return out;
}

export const PrismaQueryStats = {
  record: recordQueryTiming,
  snapshot: snapshotPrismaStats,
  buckets: BUCKETS_MS,
  reset: () => series.clear(),
};
