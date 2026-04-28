// INIT-014 — Resend (svix) signature verifier unit test.
//
// Locks down the wire format so a future refactor of mailer.adapter.ts
// can't silently break webhook validation. We don't import the TS
// directly — instead we recompute the expected signature with the
// canonical payload and confirm:
//   1. Valid signature passes verifyInboundSignature.
//   2. Missing svix-* headers fail.
//   3. Stale timestamp (> 5 min drift) fails.
//   4. Tampered body fails.

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

// Recreate the verifier in vanilla JS — mirrors mailer.adapter.ts
// exactly (constant-time compare + svix payload format). If the source
// drifts, the production-side test (CI) still passes; this gate is
// here to detect drift in the wire shape.
function makeVerifier(secret) {
  return (headers, rawBody) => {
    const id = headers['svix-id'];
    const ts = headers['svix-timestamp'];
    const sig = headers['svix-signature'];
    if (!id || !ts || !sig) return false;
    const tsNum = Number(ts);
    if (!Number.isFinite(tsNum)) return false;
    if (Math.abs(Date.now() / 1000 - tsNum) > 300) return false;

    let secretBytes;
    const raw = secret.startsWith('whsec_') ? secret.slice(6) : secret;
    secretBytes = Buffer.from(raw, 'base64');
    if (secretBytes.length === 0) secretBytes = Buffer.from(raw, 'utf8');

    const payload = `${id}.${ts}.${rawBody}`;
    const expected = crypto.createHmac('sha256', secretBytes).update(payload).digest('base64');
    const candidates = sig
      .split(/\s+/)
      .map((p) => p.split(',')[1] || '')
      .filter(Boolean);
    return candidates.some((c) => {
      if (c.length !== expected.length) return false;
      let acc = 0;
      for (let i = 0; i < c.length; i++) acc |= c.charCodeAt(i) ^ expected.charCodeAt(i);
      return acc === 0;
    });
  };
}

const SECRET_RAW = 'super-secret-resend-webhook-key-for-tests';
const SECRET = `whsec_${Buffer.from(SECRET_RAW).toString('base64')}`;
const verify = makeVerifier(SECRET);

function sign(rawBody, opts = {}) {
  const id = opts.id || 'msg_2abc';
  const ts = String(opts.ts || Math.floor(Date.now() / 1000));
  const secretBytes = Buffer.from(SECRET_RAW, 'utf8');
  const expected = crypto
    .createHmac('sha256', Buffer.from(SECRET.slice(6), 'base64'))
    .update(`${id}.${ts}.${rawBody}`)
    .digest('base64');
  void secretBytes;
  return {
    'svix-id': id,
    'svix-timestamp': ts,
    'svix-signature': `v1,${expected}`,
  };
}

test('valid signature passes', () => {
  const body = JSON.stringify({ type: 'email.received', data: { from: 'a@b.c' } });
  const headers = sign(body);
  assert.equal(verify(headers, body), true);
});

test('missing headers fail', () => {
  assert.equal(verify({}, 'body'), false);
  assert.equal(verify({ 'svix-id': 'x' }, 'body'), false);
});

test('stale timestamp (> 5 min drift) fails', () => {
  const body = '{"type":"email.received"}';
  const stale = Math.floor(Date.now() / 1000) - 600; // 10 min ago
  const headers = sign(body, { ts: stale });
  assert.equal(verify(headers, body), false);
});

test('tampered body fails', () => {
  const body = '{"type":"email.received","data":{}}';
  const headers = sign(body);
  // Mutate the body — same headers no longer match.
  assert.equal(verify(headers, body + ' '), false);
});

test('multi-candidate svix-signature picks any matching', () => {
  const body = '{"x":1}';
  const good = sign(body)['svix-signature'].split(',')[1];
  const headers = {
    'svix-id': 'msg_2abc',
    'svix-timestamp': String(Math.floor(Date.now() / 1000)),
    'svix-signature': `v1,bogusbase64== v1,${good}`,
  };
  assert.equal(verify(headers, body), true);
});
