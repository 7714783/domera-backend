/**
 * In-memory sliding-window rate limiter keyed by a caller identity (IP, QR id,
 * etc.). Designed for low-volume public endpoints (QR landing submit, auth
 * login). Not a substitute for a distributed limiter once we scale out.
 */
type Bucket = { windowStart: number; count: number };
const store = new Map<string, Bucket>();

export function rateLimit(opts: { key: string; windowMs: number; max: number }): {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
} {
  const now = Date.now();
  const b = store.get(opts.key);
  if (!b || now - b.windowStart > opts.windowMs) {
    store.set(opts.key, { windowStart: now, count: 1 });
    return { allowed: true, remaining: opts.max - 1, retryAfterMs: 0 };
  }
  if (b.count >= opts.max) {
    return { allowed: false, remaining: 0, retryAfterMs: opts.windowMs - (now - b.windowStart) };
  }
  b.count += 1;
  return { allowed: true, remaining: opts.max - b.count, retryAfterMs: 0 };
}

export function rateLimitReset(prefix: string): void {
  for (const k of store.keys()) if (k.startsWith(prefix)) store.delete(k);
}
