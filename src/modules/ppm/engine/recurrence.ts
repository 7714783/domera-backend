import { RRule, RRuleSet, rrulestr, Frequency } from 'rrule';

/**
 * Real RFC5545 engine powered by the `rrule` npm library.
 *
 * All helpers return UTC-normalized Date instances and accept either a canonical
 * RRULE string (`FREQ=MONTHLY;INTERVAL=3`) or a composed iCal string
 * (`DTSTART:...;RRULE:FREQ=...`).
 *
 * Failure mode: invalid rule → returns `null` / `[]` so callers can guard
 * without try/catch noise.
 */

const FREQ_TO_MONTHS: Record<Frequency, (interval: number) => number> = {
  [Frequency.YEARLY]: (n) => n * 12,
  [Frequency.MONTHLY]: (n) => n,
  [Frequency.WEEKLY]: (n) => n / 4.345,
  [Frequency.DAILY]: (n) => n / 30.44,
  [Frequency.HOURLY]: () => 0,
  [Frequency.MINUTELY]: () => 0,
  [Frequency.SECONDLY]: () => 0,
};

function parseRule(rule: string): RRule | null {
  if (!rule || typeof rule !== 'string') return null;
  try {
    if (rule.includes('DTSTART') || rule.includes('\n')) {
      const obj = rrulestr(rule, { forceset: false });
      return obj instanceof RRuleSet ? (obj.rrules()[0] || null) : (obj as RRule);
    }
    // canonical short form — provide a default dtstart so library can expand.
    return new RRule({ ...RRule.parseString(rule), dtstart: new Date() });
  } catch {
    return null;
  }
}

/** Average months per recurrence step — useful for UI "every N months" display. */
export function approxMonths(rule: string, fallback = 12): number {
  const r = parseRule(rule);
  if (!r) return fallback;
  const interval = r.options.interval || 1;
  return FREQ_TO_MONTHS[r.options.freq](interval) || fallback;
}

/** Compute the next due date AFTER `from` given the rule. */
export function nextAfter(rule: string, from: Date): Date | null {
  const r = parseRule(rule);
  if (!r) return null;
  const cloned = new RRule({ ...r.options, dtstart: from });
  return cloned.after(from, false);
}

/** Enumerate all due dates between `from` and `to` (inclusive of both). */
export function between(rule: string, from: Date, to: Date): Date[] {
  const r = parseRule(rule);
  if (!r) return [];
  const cloned = new RRule({ ...r.options, dtstart: from });
  return cloned.between(from, to, true);
}

/** Add N months to a date using pure UTC arithmetic (no DST drift). */
export function addMonthsUtc(from: Date, months: number): Date {
  const d = new Date(from);
  if (months >= 1) {
    d.setUTCMonth(d.getUTCMonth() + Math.round(months));
  } else {
    d.setUTCDate(d.getUTCDate() + Math.round(months * 30));
  }
  return d;
}

export { RRule };
