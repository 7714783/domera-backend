import fs from 'node:fs';
import path from 'node:path';
import pkg from '@prisma/client';
const { PrismaClient } = pkg;

function splitSql(sql) {
  const parts = [];
  let buf = '';
  let inDollar = false;
  let inSingle = false;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    const next2 = sql.slice(i, i + 2);
    if (!inSingle && next2 === '$$') {
      inDollar = !inDollar;
      buf += '$$';
      i += 1;
      continue;
    }
    if (!inDollar && c === "'") {
      inSingle = !inSingle;
      buf += c;
      continue;
    }
    if (!inDollar && !inSingle && c === ';') {
      const t = buf.trim();
      if (t) parts.push(t);
      buf = '';
      continue;
    }
    buf += c;
  }
  const tail = buf.trim();
  if (tail) parts.push(tail);
  return parts.filter((p) => !/^--/.test(p) && p.length > 0);
}

function loadFile(name) {
  const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\//, ''));
  const p = path.join(here, name);
  const fb = path.resolve(process.cwd(), 'apps/api/prisma/rls', name);
  const resolved = fs.existsSync(p) ? p : fb;
  return fs.readFileSync(resolved, 'utf8');
}

async function applyOn(client, name) {
  const raw = loadFile(name);
  const sql = raw.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');
  const stmts = splitSql(sql);
  for (const stmt of stmts) {
    await client.$executeRawUnsafe(stmt);
  }
  console.log(`[rls] ${name} → ${stmts.length} statements applied`);
}

async function run() {
  const files = (process.argv.slice(2).length
    ? process.argv.slice(2)
    : ['001_enable_rls.sql']
  );

  const needsSuperuser = files.some((f) => f.includes('002_split_roles') || f.includes('003_force_rls'));
  const url = needsSuperuser
    ? (process.env.DATABASE_URL_SUPER || process.env.DATABASE_URL_MIGRATOR || process.env.DATABASE_URL)
    : (process.env.DATABASE_URL_MIGRATOR || process.env.DATABASE_URL);

  const client = new PrismaClient({ datasources: { db: { url } } });
  try {
    for (const f of files) {
      await applyOn(client, f);
    }
  } finally {
    await client.$disconnect();
  }
}

run().catch((error) => {
  console.error('[rls] failed', error);
  process.exit(1);
});
