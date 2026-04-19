import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { MetricsService } from './metrics.service';

@Injectable()
export class MetricsMiddleware implements NestMiddleware {
  constructor(private readonly metrics: MetricsService) {}

  use(req: Request, res: Response, next: NextFunction) {
    const start = process.hrtime.bigint();
    const counter = this.metrics.counter('http_requests_total', 'HTTP requests', ['method', 'status']);
    const durMs = this.metrics.counter('http_request_duration_ms_total', 'Cumulative request time in ms', ['method']);
    res.on('finish', () => {
      const durNs = Number(process.hrtime.bigint() - start);
      const durationMs = Math.round(durNs / 1_000_000);
      counter.inc({ method: req.method, status: String(res.statusCode) });
      durMs.inc({ method: req.method }, durationMs);
    });
    next();
  }
}
