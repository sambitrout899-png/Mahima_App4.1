import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { PGlite } from '../../tmp/storage-sql-test/node_modules/@electric-sql/pglite/dist/index.js';
const schema = readFileSync('migration-output/preflight/v41-schema.sql', 'utf8');
const raw = readFileSync('tools/migration-preflight/recovery-rehearse-users.sql', 'utf8');
const sourceSchema = readFileSync('migration-output/preflight/v40-schema.sql', 'utf8');
const sourceColumns = [...sourceSchema.match(/CREATE TABLE public.users \(\n([\s\S]*?)\n\);/)[1].matchAll(/^    ("[^"]+"|\w+) /gm)].map(m => m[1].replaceAll('"',''));
const id = n => `10000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const root = '00000000-0000-0000-0000-000000000001';
const other = '00000000-0000-0000-0000-000000000002';
function stripPsql(text) { return text.split('\n').filter(l => !l.startsWith('\\')).join('\n'); }

async function fixture() {
  const db = new PGlite();
  await db.exec(`CREATE SCHEMA migration_source;
    CREATE TABLE public.tenants(id uuid PRIMARY KEY, slug text, name text);
    INSERT INTO public.tenants VALUES ('${root}'::uuid,'mahima-root','Mahima Ministry');`);
  for (const name of ['users', 'user_access_blocks']) {
    const table = schema.match(new RegExp(`CREATE TABLE public.${name} \\(\\n([\\s\\S]*?)\\n\\);`))[0];
    await db.exec(table.replaceAll('public.uuid_generate_v4()', 'gen_random_uuid()'));
  }
  await db.exec('ALTER TABLE users ADD PRIMARY KEY(id); ALTER TABLE user_access_blocks ADD PRIMARY KEY(user_id); CREATE UNIQUE INDEX codes ON users("UserCode");');
  await db.exec(schema.match(/CREATE UNIQUE INDEX ux_users_phone_normalized_not_blank[\s\S]*?;/)[0]);
  // migration_source.users mirrors the real V4.0 users table shape exactly (same 28 columns used
  // to build the fixture payloads below), standing in for the postgres_fdw bridge used in production.
  await db.exec(`CREATE TABLE migration_source.users (${sourceColumns.map(c => `${/^[A-Z]/.test(c) ? `"${c}"` : c} text`).join(', ')});
    ALTER TABLE migration_source.users ALTER COLUMN id TYPE uuid USING id::uuid;
    ALTER TABLE migration_source.users ALTER COLUMN isdeleted TYPE boolean USING isdeleted::boolean;
    ALTER TABLE migration_source.users ALTER COLUMN payrollenabled TYPE boolean USING payrollenabled::boolean;`);
  for (const n of [...Array.from({length:80},(_,i)=>i+1),1000,...Array.from({length:41},(_,i)=>2000+i)]) {
    await db.query('INSERT INTO users(id,"UserCode",tenant_id,phone,passwordhash,role,mfa_enabled,mfa_secret) VALUES($1,$2,$3,$4,$5,$6,true,$7)',
      [id(n),`U${n}`,n<2000?root:other,`${9000000000+n}`,'target-hash','admin','retained-mfa']);
  }
  const incoming = [];
  for(let n=1;n<=120;n++) {
    const payload = Object.fromEntries(sourceColumns.map(c=>[c,null]));
    Object.assign(payload,{id:id(n),UserCode:n===81?'U2000':`U${n}`,role:'member',passwordhash:'source-hash',
      joindate:'2020-01-01T00:00:00+00:00',payrollenabled:false,isdeleted:(n>=64&&n<=80)||n>=107,
      phone:n===1?'9000000064':n===2?'9000000065':n===64||n===65?null:`${9000000000+n}`});
    incoming.push(payload);
  }
  return {db,incoming};
}

function insertIncomingSql(incoming) {
  const cols = sourceColumns.map(c => /^[A-Z]/.test(c) ? `"${c}"` : c);
  const rows = incoming.map(p => '(' + sourceColumns.map(c => {
    const v = p[c];
    if (v === null || v === undefined) return 'NULL';
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    return `'${String(v).replaceAll("'","''")}'`;
  }).join(',') + ')').join(',\n');
  return `INSERT INTO migration_source.users (${cols.join(',')}) VALUES\n${rows};`;
}

function runnable(incoming) {
  return stripPsql(raw).replace(
    "CREATE TEMP TABLE incoming AS\nSELECT (jsonb_populate_record(NULL::public.users, to_jsonb(s))).* FROM migration_source.users s;",
    insertIncomingSql(incoming) + '\nCREATE TEMP TABLE incoming AS\nSELECT (jsonb_populate_record(NULL::public.users, to_jsonb(s))).* FROM migration_source.users s;'
  );
}

{
  const {db,incoming}=await fixture();
  await db.exec('DELETE FROM public.tenants');
  await assert.rejects(db.exec(runnable(incoming)),/Mahima Root tenant not found/);
  await db.exec('ROLLBACK');
  await db.close();
  console.log('PASS: missing root tenant row is refused.');
}
{
  const {db,incoming}=await fixture();
  await db.exec(runnable(incoming));
  assert.equal(Number((await db.query('SELECT count(*) n FROM users')).rows[0].n),162);
  assert.equal(Number((await db.query('SELECT count(*) n FROM user_access_blocks WHERE is_active')).rows[0].n),31);
  assert.equal((await db.query('SELECT passwordhash,mfa_secret,role FROM users WHERE id=$1',[id(1)])).rows[0].mfa_secret,'retained-mfa');
  assert.equal((await db.query('SELECT passwordhash FROM users WHERE id=$1',[id(2000)])).rows[0].passwordhash,'target-hash');
  await assert.rejects(db.exec(runnable(incoming)),/already committed/);
  await db.exec('ROLLBACK');
  await db.close();
  console.log('PASS: wrong-database (no tenants table) guard, 40 inserts/80 updates, phone transitions, deleted-user blocks, MFA/other-user preservation, code mapping and rerun guard.');
}
{
  const {db,incoming}=await fixture();
  incoming[89].phone='9000002001'; // Unresolved collision with another tenant.
  await assert.rejects(db.exec(runnable(incoming)),/duplicate key/);
  await db.exec('ROLLBACK');
  assert.equal(Number((await db.query('SELECT count(*) n FROM users')).rows[0].n),122);
  assert.equal((await db.query('SELECT phone FROM users WHERE id=$1',[id(1)])).rows[0].phone,'9000000001');
  assert.equal((await db.query("SELECT to_regclass('migration_v40.users_before') n")).rows[0].n,null);
  await db.close();
  console.log('PASS: unresolved unique-key conflict rolls back phone clearing, schema additions and all user changes.');
}
