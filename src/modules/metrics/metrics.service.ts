import { Injectable } from '@nestjs/common';

// Tiny in-process metrics registry — exposes Prometheus plain-text format.
// Zero deps. For advanced use (histograms/exemplars) swap for prom-client.

type Counter = { type: 'counter'; help: string; labels: string[]; values: Map<string, number> };
type Gauge = { type: 'gauge'; help: string; labels: string[]; values: Map<string, number> };
type Metric = Counter | Gauge;

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
      if (m.values.size === 0) {
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
