// Unit tests for cleaning-request validation + transition rules.
// Mirrors apps/api/src/modules/cleaning/cleaning.request.service.ts happy paths.

import test from 'node:test';
import assert from 'node:assert/strict';

const TERMINAL_STATUSES = new Set(['done', 'rejected', 'cancelled']);
const ALLOWED_TRANSITIONS = {
  new: ['assigned', 'rejected', 'cancelled'],
  assigned: ['in_progress', 'rejected', 'cancelled'],
  in_progress: ['done', 'rejected', 'cancelled'],
  done: [],
  rejected: [],
  cancelled: [],
};

function canTransition(from, to) {
  if (TERMINAL_STATUSES.has(from)) return false;
  return (ALLOWED_TRANSITIONS[from] || []).includes(to);
}

function validatePublicRequest(body) {
  if (!body.title || body.title.trim().length === 0) throw new Error('title required');
  if (body.title.length > 200) throw new Error('title too long');
  if (body.description && body.description.length > 2000) throw new Error('description too long');
  const validPrio = ['low', 'normal', 'high', 'urgent'];
  if (body.priority && !validPrio.includes(body.priority)) throw new Error('invalid priority');
  return true;
}

test('canTransition — new → assigned allowed', () => {
  assert.equal(canTransition('new', 'assigned'), true);
});

test('canTransition — new → done disallowed (must go through assigned + in_progress)', () => {
  assert.equal(canTransition('new', 'done'), false);
});

test('canTransition — done is terminal', () => {
  assert.equal(canTransition('done', 'in_progress'), false);
  assert.equal(canTransition('done', 'new'), false);
});

test('canTransition — cancelled is terminal', () => {
  assert.equal(canTransition('cancelled', 'new'), false);
});

test('validatePublicRequest — happy path', () => {
  assert.equal(validatePublicRequest({ title: 'Spill at reception', priority: 'normal' }), true);
});

test('validatePublicRequest — rejects missing title', () => {
  assert.throws(() => validatePublicRequest({}));
  assert.throws(() => validatePublicRequest({ title: '   ' }));
});

test('validatePublicRequest — rejects over-long fields', () => {
  assert.throws(() => validatePublicRequest({ title: 'x'.repeat(201) }));
  assert.throws(() => validatePublicRequest({ title: 'ok', description: 'x'.repeat(2001) }));
});

test('validatePublicRequest — rejects unknown priority', () => {
  assert.throws(() => validatePublicRequest({ title: 'ok', priority: 'maybe' }));
});
