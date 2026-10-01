// Isolated syntax/count test using synthetic tables, never production data.
import { readFileSync } from 'node:fs';
import { PGlite } from '../../tmp/storage-sql-test/node_modules/@electric-sql/pglite/dist/index.js';

const quote = s => '"' + s.replaceAll('"', '""') + '"';
for (const version of ['v40', 'v41']) {
  const schema = readFileSync(`migration-output/preflight/${version}-schema.sql`, 'utf8');
  const script = readFileSync(`migration-output/preflight/inventory-${version}.sql`, 'utf8');
  const db = new PGlite();
  let expected = 0;
  for (const match of schema.matchAll(/^CREATE TABLE public\.((?:"[^"]+")|\w+) \(\n([\s\S]*?)\n\);/gm)) {
    const name = match[1];
    const tenant = match[2].match(/^    ("TenantId"|tenant_id) uuid\b/m)?.[1];
    await db.exec(`CREATE TABLE public.${name} (fixture_id integer${tenant ? `, ${tenant} uuid` : ''});`);
    expected++;
  }
  if (version === 'v41') {
    await db.exec(`INSERT INTO users (fixture_id,tenant_id) VALUES
      (1,'00000000-0000-0000-0000-000000000001'),
      (2,'00000000-0000-0000-0000-000000000002'),(3,NULL);`);
    await db.exec(`INSERT INTO "Tasks" (fixture_id,"TenantId") VALUES
      (1,'00000000-0000-0000-0000-000000000001');`);
  } else {
    await db.exec('INSERT INTO users (fixture_id) VALUES (1),(2);');
  }
  const query = script.match(/^\\copy \((.*)\) TO /m)?.[1];
  if (!query) throw new Error('Missing generated count query');
  const { rows } = await db.query(query);
  if (rows.length !== expected) throw new Error(`Expected ${expected} tables, got ${rows.length}`);
  const users = rows.find(r => r.table_name === 'users');
  if (Number(users.total_rows) !== (version === 'v41' ? 3 : 2)) throw new Error('Wrong user count');
  if (version === 'v41') {
    if ([users.root_rows, users.other_tenant_rows, users.unassigned_rows].some(n => Number(n) !== 1)) throw new Error('Wrong tenant counts');
    if (Number(rows.find(r => r.table_name === 'Tasks').root_rows) !== 1) throw new Error('Mixed-case tenant column failed');
  } else if (users.root_rows !== null) throw new Error('Non-tenant table should have null ownership counts');
  console.log(`${version}: ${expected} table queries passed; empty tables, user counts and tenant handling checked.`);
  await db.close();
}
