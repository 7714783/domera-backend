// Calendar blackout: rolls a computed due date forward until it lands on a
// working day (policy=defer_to_next_working_day) or optionally returns null
// (policy=skip). Weekly recurring blackouts (dayOfWeek) encode local weekends
// (Israel → Saturday=6); one-shot/annual encode holidays and freeze windows.

export type BlackoutPolicy = 'shift' | 'skip' | 'defer_to_next_working_day';

export interface BlackoutRule {
  id: string;
  kind: string;
  label: string;
  dayOfWeek: number | null;
  startDate: Date | null;
  endDate: Date | null;
  annualRecurring: boolean;
  policy: BlackoutPolicy;
  isActive: boolean;
  buildingId: string | null;
}

function isInRange(date: Date, rule: BlackoutRule): boolean {
  if (!rule.isActive) return false;
  if (rule.dayOfWeek !== null && rule.dayOfWeek !== undefined) {
    return date.getUTCDay() === rule.dayOfWeek;
  }
  if (!rule.startDate) return false;
  const end = rule.endDate ?? rule.startDate;
  if (rule.annualRecurring) {
    const m = rule.startDate.getUTCMonth();
    const d = rule.startDate.getUTCDate();
    const em = end.getUTCMonth();
    const ed = end.getUTCDate();
    const dm = date.getUTCMonth();
    const dd = date.getUTCDate();
    if (m === em) return dm === m && dd >= d && dd <= ed;
    // wrap (e.g. Dec 31 .. Jan 2) — rare; handle inclusively
    if (dm === m) return dd >= d;
    if (dm === em) return dd <= ed;
    // months in between
    return (dm > m && dm < em) || (m > em && (dm > m || dm < em));
  }
  return date.getTime() >= rule.startDate.getTime() && date.getTime() <= end.getTime();
}

function hitsAny(date: Date, rules: BlackoutRule[], buildingId: string): { rule: BlackoutRule | null; blocked: boolean } {
  for (const r of rules) {
    if (r.buildingId && r.buildingId !== buildingId) continue;
    if (isInRange(date, r)) return { rule: r, blocked: true };
  }
  return { rule: null, blocked: false };
}

/**
 * Apply blackouts to a computed due date.
 * - If the date lands outside all blackouts → unchanged.
 * - policy=skip → returns null (caller should pick the next occurrence from RRULE).
 * - policy=defer_to_next_working_day | shift → rolls the date forward one day
 *   at a time up to 14 tries.
 */
export function applyBlackouts(
  date: Date,
  rules: BlackoutRule[],
  buildingId: string,
): Date | null {
  let cur = new Date(date.getTime());
  for (let i = 0; i < 14; i++) {
    const hit = hitsAny(cur, rules, buildingId);
    if (!hit.blocked) return cur;
    if (hit.rule?.policy === 'skip') return null;
    cur = new Date(cur.getTime() + 86400000);
  }
  return cur;
}
