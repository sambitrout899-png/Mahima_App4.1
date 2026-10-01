import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {PGlite} from '../../tmp/storage-sql-test/node_modules/@electric-sql/pglite/dist/index.js';
const raw = readFileSync('tools/migration-preflight/recovery-rehearse-finance.sql', 'utf8');
const sql = raw.replace(/^\\.*$/gm, '');
const root = '00000000-0000-0000-0000-000000000001';

function extractTable(dump, name) {
  const start = dump.indexOf(`CREATE TABLE public.${name} (`);
  return dump.slice(start, dump.indexOf('\n);', start) + 4);
}

async function fixture() {
  const db = new PGlite();
  const v40 = readFileSync('migration-output/preflight/v40-schema.sql', 'utf8');
  const v41 = readFileSync('migration-output/preflight/v41-schema.sql', 'utf8');
  await db.exec(`CREATE SCHEMA migration_source; CREATE SCHEMA migration_v40;
    CREATE TABLE public.tenants(id uuid PRIMARY KEY, slug text, name text);
    INSERT INTO public.tenants VALUES ('${root}'::uuid,'mahima-root','Mahima Ministry');`);
  for (const name of ['accounts', 'journal_entries', 'journal_lines', 'expenses']) {
    await db.exec(extractTable(v41, name));
    await db.exec(extractTable(v40, name).replace('public.', 'migration_source.'));
  }
  await db.exec(`
    ALTER TABLE public.accounts ADD PRIMARY KEY(id);
    ALTER TABLE public.journal_entries ADD PRIMARY KEY(id);
    ALTER TABLE public.journal_lines ADD PRIMARY KEY(id);
    ALTER TABLE public.expenses ADD PRIMARY KEY(id);
    CREATE SEQUENCE public.journal_entries_id_seq OWNED BY public.journal_entries.id;
    ALTER TABLE public.journal_entries ALTER COLUMN id SET DEFAULT nextval('public.journal_entries_id_seq');
    CREATE SEQUENCE public.journal_lines_id_seq OWNED BY public.journal_lines.id;
    ALTER TABLE public.journal_lines ALTER COLUMN id SET DEFAULT nextval('public.journal_lines_id_seq');
    CREATE SEQUENCE public.expenses_id_seq OWNED BY public.expenses.id;
    ALTER TABLE public.expenses ALTER COLUMN id SET DEFAULT nextval('public.expenses_id_seq');

    -- accounts already reconciled by the prior stage: source 1,2 map onto existing root accounts 1,2
    INSERT INTO public.accounts(id,name,type,created_at,tenant_id) VALUES
      (1,'Cash','asset','2020-01-01Z','${root}'::uuid),(2,'Tithes','income','2020-01-01Z','${root}'::uuid);
    INSERT INTO migration_source.accounts(id,name,type,created_at) VALUES
      (1,'Cash','asset','2020-01-01Z'),(2,'Tithes','income','2020-01-01Z');
    CREATE TABLE migration_v40.account_id_map(source_id bigint PRIMARY KEY,target_id bigint NOT NULL UNIQUE,action text NOT NULL);
    INSERT INTO migration_v40.account_id_map VALUES (1,1,'reuse_identical'),(2,2,'reuse_identical');

    -- journal_entries: target already has id=1 (byte-identical to source's id=1 -> reusable) and
    -- id=2 (different content from source's own id=2 -> must be remapped, not overwritten)
    INSERT INTO public.journal_entries(id,date,description,created_at,tenant_id) VALUES
      (1,'2020-01-01Z','Opening balance','2020-01-01Z'::timestamptz,'${root}'::uuid),
      (2,'2020-02-01Z','Existing V4.1 entry','2020-02-01Z'::timestamptz,'${root}'::uuid);
    INSERT INTO migration_source.journal_entries(id,date,description,created_at) VALUES
      (1,'2020-01-01Z','Opening balance','2020-01-01Z'::timestamptz),
      (2,'2020-03-01Z','Different source entry','2020-03-01Z'::timestamptz),
      (3,'2020-04-01Z','New source entry','2020-04-01Z'::timestamptz);

    INSERT INTO public.journal_lines(id,journal_entry_id,account_id,debit,credit) VALUES
      (1,1,1,100,0),(2,1,2,0,100);
    INSERT INTO migration_source.journal_lines(id,journal_entry_id,account_id,debit,credit) VALUES
      (1,1,1,100,0),(2,1,2,0,100),
      (3,2,1,50,0),(4,2,2,0,50),
      (5,3,1,25,0),(6,3,2,0,25);

    INSERT INTO migration_source.expenses(id,description,category,amount,date,created_at,updated_at) VALUES
      (1,'Electricity bill','utilities',500.00,'2020-01-01','2020-01-01Z'::timestamptz,'2020-01-01Z'::timestamptz),
      (2,'Office supplies','supplies',200.00,'2020-01-02','2020-01-02Z'::timestamptz,'2020-01-02Z'::timestamptz);
  `);
  return db;
}

{
  const db = await fixture();
  await db.exec(sql);

  assert.equal(Number((await db.query('SELECT count(*) n FROM journal_entries')).rows[0].n), 4,
    '2 pre-existing (entry 1 reused as-is, entry 2 untouched) + 2 new inserts (remapped source entry 2, and source entry 3 under its own id)');
  assert.equal(Number((await db.query('SELECT count(*) n FROM journal_lines')).rows[0].n), 6,
    'lines 1,2 reused with entry 1; 4 new lines inserted for the remapped/new entries');
  assert.equal(
    (await db.query("SELECT description d FROM journal_entries WHERE id=2")).rows[0].d,
    'Existing V4.1 entry', 'pre-existing entry 2 was not overwritten by the differing source entry 2');
  const remapped = await db.query("SELECT id FROM journal_entries WHERE description='Different source entry'");
  assert.equal(remapped.rows.length, 1);
  assert.notEqual(remapped.rows[0].id, 2, 'the differing source entry 2 was inserted under a new id, not overwriting target id 2');
  const newEntryId = remapped.rows[0].id;
  const itsLines = await db.query('SELECT account_id,debit,credit FROM journal_lines WHERE journal_entry_id=$1 ORDER BY account_id', [newEntryId]);
  assert.deepEqual(itsLines.rows.map(r => [Number(r.account_id), Number(r.debit), Number(r.credit)]), [[1,50,0],[2,0,50]]);

  assert.equal(Number((await db.query('SELECT count(*) n FROM expenses')).rows[0].n), 2);
  assert.equal(Number((await db.query("SELECT sum(amount) n FROM expenses")).rows[0].n), 700);

  const totals = (await db.query('SELECT source_debit,mapped_debit,source_credit,mapped_credit FROM migration_v40.finance_totals')).rows[0];
  assert.equal(Number(totals.source_debit), Number(totals.mapped_debit));
  assert.equal(Number(totals.source_credit), Number(totals.mapped_credit));

  await assert.rejects(() => db.exec(sql), /already committed/);
  await db.exec('ROLLBACK');
  await db.close();
  console.log('PASS: identical journal reused, differing journal remapped (header+lines), new journal inserted, expenses inserted, totals reconcile, rerun guard.');
}
{
  const db = await fixture();
  await db.exec(`INSERT INTO public.expenses(id,description,category,amount,date,created_at,updated_at,tenant_id)
    VALUES (99,'Pre-existing V4.1 expense','misc',10,'2020-01-01','2020-01-01Z'::timestamptz,'2020-01-01Z'::timestamptz,'${root}'::uuid)`);
  await assert.rejects(() => db.exec(sql), /Destination expenses table is not empty/);
  await db.exec('ROLLBACK');
  assert.equal((await db.query("SELECT to_regclass('migration_v40.journal_entry_id_map') n")).rows[0].n, null);
  await db.close();
  console.log('PASS: a non-empty destination expenses table aborts rather than guessing at expense id collisions.');
}
{
  const db = new PGlite();
  await db.exec('CREATE SCHEMA migration_source; CREATE SCHEMA migration_v40;');
  await assert.rejects(() => db.exec(sql), /Not a multi-tenant \(V4.1\) database/);
  await db.close();
  console.log('PASS: running against a database with no tenants table is refused.');
}
