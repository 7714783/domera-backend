import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { MetricsService } from './metrics.service';
import { PrismaQueryStats } from '../../prisma/prisma-query-stats';

@Controller('metrics')
export class MetricsController {
  constructor(private readonly svc: MetricsService) {}

  @Get()
  render(@Res() res: Response) {
    res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    // PERF-001 Stage 1 — append Prisma per-(model,operation) stats so
    // the same /metrics scrape covers HTTP + DB latency in one place.
    res.send(this.svc.render() + renderPrismaStats());
  }
}

function renderPrismaStats(): string {
  const lines: string[] = [];
  const snap = PrismaQueryStats.snapshot();
  lines.push('# HELP prisma_query_count_total Prisma queries by (model, operation)');
  lines.push('# TYPE prisma_query_count_total counter');
  lines.push('# HELP prisma_query_duration_ms_total Cumulative Prisma query time in ms');
  lines.push('# TYPE prisma_query_duration_ms_total counter');
  lines.push('# HELP prisma_query_duration_ms Prisma query latency histogram (ms)');
  lines.push('# TYPE prisma_query_duration_ms histogram');
  if (snap.length === 0) {
    lines.push('prisma_query_count_total 0');
    lines.push('prisma_query_duration_ms_total 0');
  }
  for (const row of snap) {
    const labels = `model="${row.model}",operation="${row.operation}"`;
    lines.push(`prisma_query_count_total{${labels}} ${row.count}`);
    lines.push(`prisma_query_duration_ms_total{${labels}} ${row.sumMs.toFixed(3)}`);
    let cumulative = 0;
    for (const b of PrismaQueryStats.buckets) {
      cumulative += row.buckets[String(b)] || 0;
      // Buckets are already cumulative in the collector; emit raw.
      lines.push(
        `prisma_query_duration_ms_bucket{${labels},le="${b}"} ${row.buckets[String(b)] || 0}`,
      );
    }
    lines.push(`prisma_query_duration_ms_bucket{${labels},le="+Inf"} ${row.count}`);
    lines.push(`prisma_query_duration_ms_count{${labels}} ${row.count}`);
    lines.push(`prisma_query_duration_ms_sum{${labels}} ${row.sumMs.toFixed(3)}`);
    void cumulative;
  }
  return lines.join('\n') + '\n';
}
