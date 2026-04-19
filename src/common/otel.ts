// Minimal OpenTelemetry trace emitter. Zero deps. Posts OTLP/HTTP JSON spans to
// `OTEL_EXPORTER_OTLP_ENDPOINT` when the env var is set; otherwise no-op.
//
// Contract: call `trace.span(name, attrs, fn)` to wrap a unit of work. The
// wrapper records duration, status, and exceptions. Traces correlate via
// `traceId`, which can be provided by callers (e.g. middleware reading the
// W3C `traceparent` header) or generated on the fly.

import { randomBytes } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { logger } from './logger';

const OTLP_ENDPOINT = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
const OTLP_HEADERS = (() => {
  const raw = process.env.OTEL_EXPORTER_OTLP_HEADERS;
  if (!raw) return {} as Record<string, string>;
  const out: Record<string, string> = {};
  for (const pair of raw.split(',')) {
    const [k, v] = pair.split('=');
    if (k && v) out[k.trim()] = v.trim();
  }
  return out;
})();
const SERVICE_NAME = process.env.OTEL_SERVICE_NAME || 'domera-api';

interface Span {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  startNs: bigint;
  attrs: Record<string, string | number | boolean>;
}

const als = new AsyncLocalStorage<Span>();

function hex(bytes: number): string {
  return randomBytes(bytes).toString('hex');
}

async function exportSpan(completed: Span, endNs: bigint, status: 'ok' | 'error', errorMsg?: string) {
  if (!OTLP_ENDPOINT) return;
  try {
    const body = {
      resourceSpans: [{
        resource: { attributes: [{ key: 'service.name', value: { stringValue: SERVICE_NAME } }] },
        scopeSpans: [{
          scope: { name: 'domera', version: '1.0.0' },
          spans: [{
            traceId: completed.traceId,
            spanId: completed.spanId,
            parentSpanId: completed.parentSpanId,
            name: completed.name,
            kind: 1,
            startTimeUnixNano: String(completed.startNs),
            endTimeUnixNano: String(endNs),
            attributes: Object.entries(completed.attrs).map(([k, v]) => ({
              key: k,
              value: typeof v === 'string' ? { stringValue: v }
                   : typeof v === 'boolean' ? { boolValue: v }
                   : { intValue: String(v) },
            })),
            status: { code: status === 'ok' ? 1 : 2, message: errorMsg },
          }],
        }],
      }],
    };
    const res = await fetch(`${OTLP_ENDPOINT}/v1/traces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...OTLP_HEADERS },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      logger.warn('otel.export.failed', { status: res.status, name: completed.name });
    }
  } catch (e: any) {
    logger.warn('otel.export.threw', { err: String(e?.message || e) });
  }
}

function parseTraceparent(h: string | undefined): { traceId?: string; parentSpanId?: string } {
  if (!h) return {};
  const parts = h.split('-');
  if (parts.length !== 4) return {};
  return { traceId: parts[1], parentSpanId: parts[2] };
}

export const trace = {
  /** Start a span for the enclosing scope; if no OTLP endpoint, becomes a no-op. */
  span<T>(name: string, attrs: Record<string, string | number | boolean>, fn: () => Promise<T> | T): Promise<T> {
    const parent = als.getStore();
    const span: Span = {
      traceId: parent?.traceId || hex(16),
      spanId: hex(8),
      parentSpanId: parent?.spanId,
      name,
      startNs: process.hrtime.bigint() + BigInt(Date.now() * 1_000_000) - BigInt(Math.floor(process.uptime() * 1_000_000_000)),
      attrs,
    };
    return als.run(span, async () => {
      try {
        const res = await fn();
        const endNs = process.hrtime.bigint() + BigInt(Date.now() * 1_000_000) - BigInt(Math.floor(process.uptime() * 1_000_000_000));
        void exportSpan(span, endNs, 'ok');
        return res;
      } catch (e: any) {
        const endNs = process.hrtime.bigint() + BigInt(Date.now() * 1_000_000) - BigInt(Math.floor(process.uptime() * 1_000_000_000));
        void exportSpan(span, endNs, 'error', String(e?.message || e));
        throw e;
      }
    });
  },
  /** Seed a span from an incoming W3C `traceparent` header. */
  fromHeader(traceparent: string | undefined, name: string, attrs: Record<string, string | number | boolean>, fn: () => Promise<any>) {
    const seed = parseTraceparent(traceparent);
    const span: Span = {
      traceId: seed.traceId || hex(16),
      spanId: hex(8),
      parentSpanId: seed.parentSpanId,
      name, attrs,
      startNs: BigInt(Date.now() * 1_000_000),
    };
    return als.run(span, fn);
  },
  enabled(): boolean {
    return !!OTLP_ENDPOINT;
  },
};
