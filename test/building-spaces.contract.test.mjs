// INIT-012 NS-15 — pin the building-spaces module contract.
//
// Source-level pin keeps the module honest as it grows:
//
//   1. Service must be manager-gated on every write — uses the
//      shared requireManager helper (so the auth bar matches the
//      rest of the building-core / occupants modules).
//   2. Reads + writes must be tenant-scoped via top-level tenantId
//      in every prisma where clause — the prisma RLS wrapper rejects
//      anything else.
//   3. Controller must mount under buildings/:slug to keep the URL
//      shape stable for the frontend Building Passport card.
//   4. Allowed spaceType + elementType + conditionState enums must
//      stay aligned with the documented vocabulary.
//
// If a refactor changes any of these, the gate fails and the engineer
// must restore the contract or update the pin (and the dashboard).

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const moduleDir = join(here, '..', 'src', 'modules', 'building-spaces');
const serviceSrc = readFileSync(join(moduleDir, 'building-spaces.service.ts'), 'utf8');
const controllerSrc = readFileSync(join(moduleDir, 'building-spaces.controller.ts'), 'utf8');

test('controller mounts under buildings/:slug', () => {
  assert.match(
    controllerSrc,
    /@Controller\(\s*['"]buildings\/:slug['"]\s*\)/,
    'BuildingSpacesController must be @Controller("buildings/:slug") so the Building Passport links resolve',
  );
});

test('controller exposes spaces + elements CRUD (8 routes)', () => {
  // Spaces — list/create/patch/delete
  assert.match(controllerSrc, /@Get\(\s*['"]spaces['"]\s*\)/, 'GET /spaces missing');
  assert.match(controllerSrc, /@Post\(\s*['"]spaces['"]\s*\)/, 'POST /spaces missing');
  assert.match(
    controllerSrc,
    /@Patch\(\s*['"]spaces\/:spaceId['"]\s*\)/,
    'PATCH /spaces/:spaceId missing',
  );
  assert.match(
    controllerSrc,
    /@Delete\(\s*['"]spaces\/:spaceId['"]\s*\)/,
    'DELETE /spaces/:spaceId missing',
  );
  // Elements — list/create/patch/delete
  assert.match(controllerSrc, /@Get\(\s*['"]elements['"]\s*\)/, 'GET /elements missing');
  assert.match(controllerSrc, /@Post\(\s*['"]elements['"]\s*\)/, 'POST /elements missing');
  assert.match(
    controllerSrc,
    /@Patch\(\s*['"]elements\/:elementId['"]\s*\)/,
    'PATCH /elements/:elementId missing',
  );
  assert.match(
    controllerSrc,
    /@Delete\(\s*['"]elements\/:elementId['"]\s*\)/,
    'DELETE /elements/:elementId missing',
  );
});

test('every service write requires manager auth', () => {
  // Each create/update/delete method must call this.requireManager(tenantId, actorUserId)
  // before touching the database — otherwise a regular member could
  // bypass the building manager bar.
  const writeMethods = ['createSpace', 'updateSpace', 'deleteSpace'];
  const writeMethodsEl = ['createElement', 'updateElement', 'deleteElement'];
  for (const m of [...writeMethods, ...writeMethodsEl]) {
    const sig = new RegExp(
      `async\\s+${m}\\s*\\([\\s\\S]*?\\)\\s*\\{[\\s\\S]*?await this\\.requireManager\\(`,
    );
    assert.match(
      serviceSrc,
      sig,
      `BuildingSpacesService.${m} must call await this.requireManager(...) before mutating`,
    );
  }
});

test('all prisma reads + counts scope by tenantId at top level', () => {
  // Every prisma.buildingSpace / prisma.buildingElement read must
  // include tenantId in its top-level where clause — required by the
  // auto-RLS wrapper. update/delete go through findFirst guarded
  // by tenantId first; create supplies tenantId via data:.
  const queries = serviceSrc.match(
    /this\.prisma\.(buildingSpace|buildingElement)\.(findFirst|findMany|count)\([\s\S]*?\}\)/g,
  );
  assert.ok(queries && queries.length > 0, 'expected prisma reads in building-spaces.service.ts');
  for (const q of queries) {
    assert.ok(
      /where:\s*\{[^}]*tenantId/.test(q),
      `query must include tenantId in where: ${q.slice(0, 120)}…`,
    );
  }
});

test('create paths supply tenantId via data:', () => {
  // Per Prisma RLS wrapper contract, create() needs tenantId on the
  // data payload (not where:). Pin both creates.
  for (const m of ['buildingSpace', 'buildingElement']) {
    const re = new RegExp(`this\\.prisma\\.${m}\\.create\\(\\s*\\{\\s*data:\\s*\\{\\s*tenantId`);
    assert.match(
      serviceSrc,
      re,
      `prisma.${m}.create must pass tenantId as the first key on data: (RLS wrapper requires it)`,
    );
  }
});

test('spaceType vocabulary is enforced', () => {
  for (const t of [
    'mechanical_room',
    'restroom',
    'lobby',
    'storage',
    'utility',
    'parking_zone',
    'other',
  ]) {
    assert.ok(
      serviceSrc.includes(`'${t}'`),
      `SPACE_TYPES must include '${t}' (canonical vocabulary from schema 023)`,
    );
  }
});

test('elementType + conditionState vocabularies are enforced', () => {
  for (const t of ['roof', 'basement', 'facade', 'door', 'window', 'garden', 'parking_lot']) {
    assert.ok(
      serviceSrc.includes(`'${t}'`),
      `ELEMENT_TYPES must include '${t}' (canonical vocabulary from schema 023)`,
    );
  }
  for (const c of ['good', 'fair', 'poor', 'critical']) {
    assert.ok(
      serviceSrc.includes(`'${c}'`),
      `CONDITION_STATES must include '${c}' (canonical vocabulary from schema 023)`,
    );
  }
});
