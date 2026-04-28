// Unit tests for the public QR wizard payload composition.
// Mirrors the description-folding in apps/frontend/src/app/[locale]/qr/[qrId]/page.tsx
// (the wizard collects title/description/when/contact and folds into a
// single service-request payload).

import test from 'node:test';
import assert from 'node:assert/strict';

function composeDescription({ title, description, when, whenLabel, scheduledAt, contactLabel }) {
  const parts = [];
  if (title) parts.push(title);
  if (description) parts.push(description);
  const whenSuffix = when === 'scheduled' && scheduledAt ? ` · ${scheduledAt}` : '';
  parts.push(`[${whenLabel}${whenSuffix}]`);
  parts.push(`[${contactLabel}]`);
  return parts.join('\n');
}

test('composeDescription — minimal payload (title + now + app)', () => {
  const d = composeDescription({
    title: 'Spill in restroom',
    when: 'now',
    whenLabel: 'Right now',
    contactLabel: 'No contact',
  });
  assert.match(d, /Spill in restroom/);
  assert.match(d, /\[Right now\]/);
  assert.match(d, /\[No contact\]/);
});

test('composeDescription — scheduled date is appended only when set', () => {
  const d = composeDescription({
    title: 't',
    when: 'scheduled',
    whenLabel: 'Pick a date',
    scheduledAt: '2026-06-15T10:00',
    contactLabel: 'Text me',
  });
  assert.match(d, /\[Pick a date · 2026-06-15T10:00\]/);
});

test('composeDescription — scheduled with no date omits suffix', () => {
  const d = composeDescription({
    title: 't',
    when: 'scheduled',
    whenLabel: 'Pick a date',
    contactLabel: 'Call me',
  });
  assert.match(d, /\[Pick a date\]/);
  assert.doesNotMatch(d, /·/);
});

test('composeDescription — omits empty title/description lines', () => {
  const d = composeDescription({
    when: 'now',
    whenLabel: 'Right now',
    contactLabel: 'No contact',
  });
  const lines = d.split('\n');
  assert.equal(lines.length, 2);
  assert.match(lines[0], /\[Right now\]/);
  assert.match(lines[1], /\[No contact\]/);
});
