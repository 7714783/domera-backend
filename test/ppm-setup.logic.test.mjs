// Unit tests for PPM takeover/setup row-validation logic. Mirrors the
// `rowReady` predicate from apps/frontend/src/components/domera/pages/ppm-setup.tsx
// — kept in sync with backend recordPpmBaselineBulk contract.

import test from 'node:test';
import assert from 'node:assert/strict';

function rowReady(e) {
  if (!e || !e.mode) return false;
  if (e.mode === 'set') {
    if (!e.lastPerformedAt || e.lastPerformedAt.length < 10) return false;
    if (!e.evidenceDocumentId) return false;
  }
  return true;
}

test('rowReady — empty row is not ready', () => {
  assert.equal(rowReady(null), false);
  assert.equal(rowReady({}), false);
  assert.equal(rowReady({ mode: '' }), false);
});

test('rowReady — mode=set needs date AND evidence', () => {
  assert.equal(rowReady({ mode: 'set' }), false);
  assert.equal(rowReady({ mode: 'set', lastPerformedAt: '2024-01-01' }), false);
  assert.equal(
    rowReady({ mode: 'set', lastPerformedAt: '2024-01-01', evidenceDocumentId: 'doc-1' }),
    true,
  );
});

test('rowReady — unknown_immediate ready without date/evidence', () => {
  assert.equal(rowReady({ mode: 'unknown_immediate' }), true);
});

test('rowReady — unknown_backdated ready without date/evidence', () => {
  assert.equal(rowReady({ mode: 'unknown_backdated' }), true);
});

test('rowReady — mode=set with short lastPerformedAt rejected', () => {
  // Less than 10 chars (full ISO-date) is treated as invalid
  assert.equal(
    rowReady({ mode: 'set', lastPerformedAt: '24-1-1', evidenceDocumentId: 'd' }),
    false,
  );
});
