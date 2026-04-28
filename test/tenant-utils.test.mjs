// Unit tests for resolveTenantId — the previous silent fallback to 'ten_demo'
// was the P0 root cause letting new accounts see demo workspace data.
import test from 'node:test';
import assert from 'node:assert/strict';

const { resolveTenantId } = await import('../src/common/tenant.utils.ts');

test('resolveTenantId — returns the provided header value', () => {
  assert.equal(resolveTenantId('ten_abc'), 'ten_abc');
});

test('resolveTenantId — throws when header is missing', () => {
  assert.throws(() => resolveTenantId(undefined), /X-Tenant-Id header is required/);
});

test('resolveTenantId — throws when header is empty string', () => {
  assert.throws(() => resolveTenantId(''), /X-Tenant-Id header is required/);
});

test('resolveTenantId — no longer defaults to ten_demo (regression)', () => {
  assert.throws(
    () => resolveTenantId(undefined),
    (err) => {
      // Must NOT silently pass through with the demo tenant.
      assert.notEqual(err?.message, 'ten_demo');
      return true;
    },
  );
});
