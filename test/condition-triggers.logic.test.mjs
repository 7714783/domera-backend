// Unit tests for thresholdMet() in condition-triggers.service.ts.
// Covers each comparison operator and the crossing edge cases.
// Run via: pnpm --filter @domera/api test

import test from 'node:test';
import assert from 'node:assert/strict';

const { thresholdMet } =
  await import('../src/modules/condition-triggers/condition-triggers.logic.ts');

test('thresholdMet — gt/gte/lt/lte/eq/ne behave like their operator', () => {
  assert.equal(thresholdMet('gt', 11, 10, null), true);
  assert.equal(thresholdMet('gt', 10, 10, null), false);
  assert.equal(thresholdMet('gte', 10, 10, null), true);
  assert.equal(thresholdMet('lt', 9, 10, null), true);
  assert.equal(thresholdMet('lte', 10, 10, null), true);
  assert.equal(thresholdMet('eq', 10, 10, null), true);
  assert.equal(thresholdMet('ne', 11, 10, null), true);
  assert.equal(thresholdMet('ne', 10, 10, null), false);
});

test('thresholdMet — crossing fires when reading crosses threshold upward', () => {
  assert.equal(thresholdMet('crossing', 11, 10, 9), true);
});

test('thresholdMet — crossing fires when reading crosses threshold downward', () => {
  assert.equal(thresholdMet('crossing', 9, 10, 11), true);
});

test('thresholdMet — crossing does NOT fire with null last reading', () => {
  assert.equal(thresholdMet('crossing', 11, 10, null), false);
});

test('thresholdMet — crossing does NOT fire when both readings on same side', () => {
  assert.equal(thresholdMet('crossing', 12, 10, 11), false);
  assert.equal(thresholdMet('crossing', 8, 10, 9), false);
});

test('thresholdMet — unknown operator returns false (safe default)', () => {
  assert.equal(thresholdMet('bogus', 10, 10, 10), false);
});
