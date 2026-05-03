import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { MetricsService } from './metrics.service';

// PERF-001 Stage 1 — route-level latency observability.
//
// Histogram label = (method, route, status_class) where `route` is the
// path with high-cardinality segments (uuids, slugs, numeric ids)
// collapsed to placeholders. Without normalization every distinct
// /v1/buildings/<uuid> would explode the time-series count and make the
// metric useless. status_class buckets the four 1xx/2xx/4xx/5xx
// families so a 200 vs 201 vs 204 don't fragment the histogram.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUMERIC_RE = /^\d+$/;
// "slug-like": anything that's not obviously a fixed route segment.
// Heuristic — ≥2 chars and starts with a letter; flagged as :slug if
// not in the known fixed-segment allowlist below. Errs on the side of
// over-normalizing; under-normalizing leaks cardinality.
const FIXED_SEGMENTS = new Set([
  'v1',
  'health',
  'metrics',
  'auth',
  'login',
  'register',
  'logout',
  'refresh',
  'switch-workspace',
  'verify',
  'mfa',
  'sso',
  'scim',
  'me',
  'session',
  'sessions',
  'devices',
  'notifications',
  'preferences',
  'deliveries',
  'rules',
  'templates',
  'test-email',
  'mail',
  'inbound',
  'buildings',
  'floors',
  'units',
  'unit-groups',
  'locations',
  'transport',
  'systems',
  'occupants',
  'occupancies',
  'contracts',
  'parking',
  'storage',
  'spaces',
  'elements',
  'equipment-relations',
  'elevators',
  'sensors',
  'alarms',
  'assets',
  'tags',
  'summary',
  'publish',
  'archive',
  'reactivate',
  'organizations',
  'team',
  'members',
  'roles',
  'role-assignments',
  'eligible',
  'contractors',
  'public',
  'workspace',
  'tenant-companies',
  'occupant-companies',
  'leases',
  'allocations',
  'compliance',
  'compliance-profiles',
  'obligations',
  'mandates',
  'ppm',
  'plan-items',
  'baseline',
  'wizard',
  'setup',
  'tasks',
  'inbox',
  'kind',
  'complete',
  'pause',
  'resume',
  'reactive',
  'incidents',
  'service-requests',
  'work-orders',
  'quotes',
  'purchase-orders',
  'completion-records',
  'cleaning',
  'zones',
  'qr-points',
  'admin',
  'requests',
  'workflows',
  'audit',
  'search',
  'approvals',
  'requests',
  'steps',
  'delegations',
  'documents',
  'links',
  'document-templates',
  'imports',
  'jobs',
  'rows',
  'inventory',
  'items',
  'movements',
  'projects',
  'stages',
  'budget-lines',
  'change-orders',
  'acceptance-packs',
  'devices',
  'sensor-points',
  'alarm-sources',
  'privacy',
  'dsar',
  'subprocessors',
  'connectors',
  'incidents',
  'webhooks',
  'sources',
  'events',
  'subscriptions',
  'rounds',
  'waypoints',
  'instances',
  'answers',
  'qr',
  'submit',
  'triage',
  'iam',
  'staff',
  'certifications',
  'memberships',
  'condition-triggers',
  'emergency-overrides',
  'calendar-blackouts',
  'role-dashboards',
  'vendor-invoices',
  'metrics',
  'tenancy',
  'onboarding',
  'building-spaces',
  'building-elements',
  'takeover',
  'cases',
  'recommendations',
]);

export function normalizeRoute(rawPath: string): string {
  const idx = rawPath.indexOf('?');
  const path = idx === -1 ? rawPath : rawPath.slice(0, idx);
  const parts = path.split('/');
  return parts
    .map((p) => {
      if (!p) return p;
      if (UUID_RE.test(p)) return ':id';
      if (NUMERIC_RE.test(p)) return ':n';
      if (FIXED_SEGMENTS.has(p)) return p;
      // Anything else with both letters and digits, or longer than 24
      // chars, is almost certainly a slug or token — collapse it.
      if (p.length > 24) return ':slug';
      if (/^[A-Za-z]/.test(p) && /\d/.test(p)) return ':slug';
      return p;
    })
    .join('/');
}

function statusClass(code: number): string {
  if (code < 200) return '1xx';
  if (code < 300) return '2xx';
  if (code < 400) return '3xx';
  if (code < 500) return '4xx';
  return '5xx';
}

@Injectable()
export class MetricsMiddleware implements NestMiddleware {
  constructor(private readonly metrics: MetricsService) {}

  use(req: Request, res: Response, next: NextFunction) {
    const start = process.hrtime.bigint();
    const counter = this.metrics.counter('http_requests_total', 'HTTP requests', [
      'method',
      'status',
    ]);
    const durMs = this.metrics.counter(
      'http_request_duration_ms_total',
      'Cumulative request time in ms',
      ['method'],
    );
    // PERF-001 Stage 1 — per-route latency histogram.
    const histogram = this.metrics.histogram(
      'http_request_duration_ms',
      'HTTP request latency by route (ms)',
      ['method', 'route', 'status_class'],
    );
    res.on('finish', () => {
      const durNs = Number(process.hrtime.bigint() - start);
      const durationMs = durNs / 1_000_000;
      counter.inc({ method: req.method, status: String(res.statusCode) });
      durMs.inc({ method: req.method }, Math.round(durationMs));
      histogram.observe(
        {
          method: req.method,
          route: normalizeRoute(req.originalUrl || req.url),
          status_class: statusClass(res.statusCode),
        },
        durationMs,
      );
    });
    next();
  }
}
