// Module boundary guard.
//
// Pinned by docs/architecture/platform-development-contract.md § 3.
// Catches the kind of "I'll just import service X from module Y because it's
// faster" smell before it grows into cross-module direct mutations.
//
// Rule: a service file may import another module's service ONLY when the
// consumer's *.module.ts actually imports the producer's NestModule
// (and therefore the service is reachable via Nest DI). Importing the
// service file without registering the module is a runtime bug
// disguised as a type-import; this test catches it statically.
//
// Universal infrastructure (audit / auth / iam) bypasses both checks —
// they are imported everywhere by design.
//
// Run: `node --test apps/api/test/module-boundaries.test.mjs`

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const modulesDir = join(here, '..', 'src', 'modules');

// Modules that are explicitly universal infrastructure — every other
// module is allowed to import their public services. The corresponding
// NestModule is @Global() so DI resolves without an explicit imports[]
// entry.
// INIT-013 — `team` and `role-assignments` are @Global() so PPM/Cleaning/
// Reactive can inject the eligible-assignees resolver without listing
// the module explicitly.
// INIT-014 — `notifications` is @Global() so domain modules can call
// the dispatcher without import cycles (kept consistent with audit/events).
const UNIVERSAL = new Set([
  'audit',
  'auth',
  'iam',
  'events',
  'role-assignments',
  'team',
  'notifications',
]);

// Pairs already linked through DI (NestModule → exported service).
// If module X imports module Y's *.service.ts directly, it should also
// be importing Y's *.module.ts in the consumer module.ts. We don't
// validate the module-import side here — that's a Nest runtime check.
// We only forbid direct service file imports across module boundaries.
const ALLOW_LIST = new Set([
  // approvals consumes outbox events, not approvals.service from other modules
  // (intentionally empty — every cross-service edge must go through a Module).
]);

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else if (e.endsWith('.ts') && !e.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

const files = walk(modulesDir);

// First pass: for each module, find its module.ts and parse the `imports: [...]`
// to build a map of moduleName → set of NestModule names it depends on.
const moduleDeps = new Map();
for (const file of files) {
  const rel = relative(modulesDir, file).replace(/\\/g, '/');
  if (!/\.module\.ts$/.test(rel)) continue;
  const moduleName = rel.split('/')[0];
  const src = readFileSync(file, 'utf8');
  const importMatch = src.match(/imports\s*:\s*\[([\s\S]*?)\]/);
  const deps = new Set();
  if (importMatch) {
    for (const m of importMatch[1].matchAll(/([A-Z][a-zA-Z0-9]*)Module\b/g)) {
      deps.add(m[1] + 'Module');
    }
  }
  moduleDeps.set(moduleName, deps);
}

// camelCase / kebab-case folder name → Nest module class name
function classNameFromFolder(folder) {
  return (
    folder
      .split('-')
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
      .join('') + 'Module'
  );
}

const violations = [];
for (const file of files) {
  const rel = relative(modulesDir, file).replace(/\\/g, '/');
  const moduleName = rel.split('/')[0];
  const src = readFileSync(file, 'utf8');
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(/from\s+['"]\.\.\/([a-z0-9-]+)\/([^'"]+)['"]/);
    if (!m) continue;
    const target = m[1];
    const targetFile = m[2];
    if (target === moduleName) continue; // sibling file — fine
    if (UNIVERSAL.has(target)) continue; // audit/auth/iam — fine
    if (/\.module(\.ts)?$/.test(targetFile)) continue; // importing the NestModule itself — fine
    const key = `${moduleName} → ${target}/${targetFile}`;
    if (ALLOW_LIST.has(key)) continue;

    // Cross-module service import — legal ONLY if this module's *.module.ts
    // imports the producer's NestModule (so DI resolves the service).
    const expectedModule = classNameFromFolder(target);
    const myDeps = moduleDeps.get(moduleName) || new Set();
    if (myDeps.has(expectedModule)) continue;

    violations.push({
      file: rel,
      line: i + 1,
      target,
      targetFile,
      expected: expectedModule,
      actor: moduleName,
      snippet: line.trim(),
    });
  }
}

test('module boundaries — no direct cross-module service imports', () => {
  if (violations.length > 0) {
    const report = violations
      .map(
        (v) =>
          `  · ${v.file}:${v.line}  imports ${v.target}/${v.targetFile}` +
          `\n    actor=${v.actor} expected ${v.expected} in ${v.actor}.module.ts imports[]` +
          `\n    ${v.snippet}`,
      )
      .join('\n');
    assert.fail(
      `${violations.length} cross-module service import(s) without a registered Nest dependency:\n${report}\n\n` +
        `Fix: register the producer's *.module.ts in your *.module.ts imports[]. ` +
        `Or move the cross-module call to publish/subscribe events. ` +
        `See docs/architecture/platform-development-contract.md § 3.`,
    );
  }
});
