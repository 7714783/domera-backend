import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

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

async function run() {
  const sqlPath = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\//, '')), '001_enable_rls.sql');
  const fallback = path.resolve(process.cwd(), 'apps/api/prisma/rls/001_enable_rls.sql');
  const resolved = fs.existsSync(sqlPath) ? sqlPath : fallback;
  const raw = fs.readFileSync(resolved, 'utf8');
  const sql = raw.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');
  const stmts = splitSql(sql);

  for (const stmt of stmts) {
    await prisma.$executeRawUnsafe(stmt);
  }
  console.log(`[rls] ${stmts.length} statements applied`);
}

run()
  .catch((error) => {
    console.error('[rls] failed', error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
