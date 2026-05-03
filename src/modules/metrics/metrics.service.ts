import { Injectable } from '@nestjs/common';

// Tiny in-process metrics registry — exposes Prometheus plain-text format.
// Zero deps. For advanced use (histograms/exemplars) swap for prom-client.

type Counter = { type: 'counter'; help: string; labels: string[]; values: Map<string, number> };
type Gauge = { type: 'gauge'; help: string; labels: string[]; values: Map<string, number> };
// PERF-001 Stage 1 — fixed-bucket histogram (Prometheus le="..." form).
// Buckets in milliseconds, chosen to cover REST + DB query latency
// distributions (sub-ms → 5s) without exploding cardinality.
type HistogramSeries = {
  buckets: Map<number, number>;
  count: number;
  sum: number;
};
type Histogram = {
  type: 'histogram';
  help: string;
  labels: string[];
  buckets: number[];
  values: Map<string, HistogramSeries>;
};
type Metric = Counter | Gauge | Histogram;

export const DEFAULT_LATENCY_BUCKETS_MS = [
  1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000,
] as const;

@Injectable()
export class MetricsService {
  private readonly metrics = new Map<string, Metric>();
  private readonly startedAt = Date.now();

  counter(name: string, help: string, labels: string[] = []) {
    let m = this.metrics.get(name);
    if (!m) {
      m = { type: 'counter', help, labels, values: new Map() };
      this.metrics.set(name, m);
    }
    return {
      inc: (labelValues: Record<string, string> = {}, value = 1) => {
        const key = this.keyFor(labels, labelValues);
        (m as Counter).values.set(key, ((m as Counter).values.get(key) || 0) + value);
      },
    };
  }

  histogram(
    name: string,
    help: string,
    labels: string[] = [],
    buckets: readonly number[] = DEFAULT_LATENCY_BUCKETS_MS,
  ) {
    let m = this.metrics.get(name);
    if (!m) {
      m = {
        type: 'histogram',
        help,
        labels,
        buckets: [...buckets].sort((a, b) => a - b),
        values: new Map(),
      };
      this.metrics.set(name, m);
    }
    const h = m as Histogram;
    return {
      observe: (labelValues: Record<string, string>, value: number) => {
        const key = this.keyFor(labels, labelValues);
        let series = h.values.get(key);
        if (!series) {
          series = { buckets: new Map(h.buckets.map((b) => [b, 0])), count: 0, sum: 0 };
          h.values.set(key, series);
        }
        for (const bucket of h.buckets) {
          if (value <= bucket) series.buckets.set(bucket, (series.buckets.get(bucket) || 0) + 1);
        }
        series.count += 1;
        series.sum += value;
      },
    };
  }

  gauge(name: string, help: string, labels: string[] = []) {
    let m = this.metrics.get(name);
    if (!m) {
      m = { type: 'gauge', help, labels, values: new Map() };
      this.metrics.set(name, m);
    }
    return {
      set: (value: number, labelValues: Record<string, string> = {}) => {
        const key = this.keyFor(labels, labelValues);
        (m as Gauge).values.set(key, value);
      },
    };
  }

  private keyFor(labels: string[], vals: Record<string, string>): string {
    if (labels.length === 0) return '';
    return labels.map((l) => `${l}="${(vals[l] || '').replace(/"/g, '\\"')}"`).join(',');
  }

  render(): string {
    const mem = process.memoryUsage();
    const uptime = (Date.now() - this.startedAt) / 1000;
    this.gauge('process_uptime_seconds', 'Process uptime in seconds').set(uptime);
    this.gauge('process_resident_memory_bytes', 'Resident memory bytes').set(mem.rss);
    this.gauge('process_heap_bytes', 'Heap bytes').set(mem.heapUsed);

    const lines: string[] = [];
    for (const [name, m] of this.metrics) {
      lines.push(`# HELP ${name} ${m.help}`);
      lines.push(`# TYPE ${name} ${m.type}`);
      if (m.type === 'histogram') {
        if (m.values.size === 0) {
          lines.push(`${name}_count 0`);
          lines.push(`${name}_sum 0`);
        } else {
          for (const [labelKey, series] of m.values) {
            const labelPrefix = labelKey ? `${labelKey},` : '';
            for (const bucket of m.buckets) {
              lines.push(
                `${name}_bucket{${labelPrefix}le="${bucket}"} ${series.buckets.get(bucket) ?? 0}`,
              );
            }
            lines.push(`${name}_bucket{${labelPrefix}le="+Inf"} ${series.count}`);
            const labelOnly = labelKey ? `{${labelKey}}` : '';
            lines.push(`${name}_count${labelOnly} ${series.count}`);
            lines.push(`${name}_sum${labelOnly} ${series.sum}`);
          }
        }
      } else if (m.values.size === 0) {
        lines.push(`${name} 0`);
      } else {
        for (const [labelKey, value] of m.values) {
          const label = labelKey ? `{${labelKey}}` : '';
          lines.push(`${name}${label} ${value}`);
        }
      }
    }
    return lines.join('\n') + '\n';
  }
}
