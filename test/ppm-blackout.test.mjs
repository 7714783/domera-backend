// Unit tests for apps/api/src/modules/ppm/engine/blackout.ts
// Run via: pnpm --filter @domera/api test

import test from 'node:test';
import assert from 'node:assert/strict';

const { applyBlackouts } = await import('../src/modules/ppm/engine/blackout.ts');

const saturdayRule = {
  id: 'r-sat',
  kind: 'weekend',
  label: 'Saturday',
  dayOfWeek: 6,
  startDate: null,
  endDate: null,
  annualRecurring: false,
  policy: 'defer_to_next_working_day',
  isActive: true,
  buildingId: null,
};

const pesachWindow = {
  id: 'r-pesach',
  kind: 'holiday',
  label: 'Pesach',
  dayOfWeek: null,
  startDate: new Date(Date.UTC(2026, 3, 1)), // Apr 1
  endDate: new Date(Date.UTC(2026, 3, 8)), // Apr 8
  annualRecurring: true,
  policy: 'skip',
  isActive: true,
  buildingId: null,
};

test('applyBlackouts — working-day Wednesday passes through untouched', () => {
  const wed = new Date(Date.UTC(2026, 3, 15)); // 2026-04-15 Wed
  const out = applyBlackouts(wed, [saturdayRule], 'b1');
  assert.equal(out.toISOString(), wed.toISOString());
});

test('applyBlackouts — Saturday defers one day forward to Sunday', () => {
  const sat = new Date(Date.UTC(2026, 3, 18)); // 2026-04-18 Sat
  const out = applyBlackouts(sat, [saturdayRule], 'b1');
  assert.ok(out, 'should return a date');
  assert.equal(out.getUTCDay(), 0, 'should roll to Sunday');
});

test('applyBlackouts — date inside skip-policy window returns null', () => {
  const midPesach = new Date(Date.UTC(2026, 3, 4));
  const out = applyBlackouts(midPesach, [pesachWindow], 'b1');
  assert.equal(out, null);
});

test('applyBlackouts — inactive rule is ignored', () => {
  const sat = new Date(Date.UTC(2026, 3, 18));
  const inactive = { ...saturdayRule, isActive: false };
  const out = applyBlackouts(sat, [inactive], 'b1');
  assert.equal(out.toISOString(), sat.toISOString());
});

test('applyBlackouts — building-scoped rule does not affect other buildings', () => {
  const sat = new Date(Date.UTC(2026, 3, 18));
  const scoped = { ...saturdayRule, buildingId: 'b-other' };
  const out = applyBlackouts(sat, [scoped], 'b-mine');
  assert.equal(out.toISOString(), sat.toISOString());
});
