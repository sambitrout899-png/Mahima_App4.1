import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {PGlite} from '../../tmp/storage-sql-test/node_modules/@electric-sql/pglite/dist/index.js';
const root='00000000-0000-0000-0000-000000000001',other='00000000-0000-0000-0000-000000000002';
const sql=readFileSync('tools/migration-preflight/recovery-rehearse-relationships.sql','utf8').replace(/^\\.*$/gm,'');
async function fixture(){
 const db=new PGlite();
 await db.exec(`CREATE SCHEMA migration_source; CREATE SCHEMA migration_v40;
 CREATE TABLE public.tenants(id uuid PRIMARY KEY, slug text, name text);
 INSERT INTO public.tenants VALUES ('${root}'::uuid,'mahima-root','Mahima Ministry');`);
 for(const v of ['v40','v41']){
  const dump=readFileSync(`migration-output/preflight/${v}-schema.sql`,'utf8');
  for(const table of ['teammembers','user_positions',v==='v40'?'"TaskAssignees"':'"TaskAssignmentsV2"']){
   const start=dump.indexOf(`CREATE TABLE public.${table} (`);
   let ddl=dump.slice(start,dump.indexOf('\n);',start)+4);
   if(v==='v40')ddl=ddl.replace('public.','migration_source.');
   await db.exec(ddl);
  }
 }
 await db.exec(`
 ALTER TABLE teammembers ADD PRIMARY KEY(teamid,userid);
 ALTER TABLE user_positions ADD PRIMARY KEY(user_id,position_id);
 CREATE UNIQUE INDEX ON user_positions(user_id) WHERE is_primary;
 ALTER TABLE "TaskAssignmentsV2" ADD PRIMARY KEY("TaskId","AssigneeType","AssigneeId");
 CREATE TABLE users(id uuid PRIMARY KEY,tenant_id uuid);
 INSERT INTO users SELECT md5(i::text)::uuid,CASE WHEN i=103 THEN '${other}'::uuid ELSE '${root}'::uuid END FROM generate_series(1,103)i;
 CREATE TABLE "Teams"("Id" bigint,"TenantId" uuid);
 INSERT INTO "Teams" VALUES(23,'${root}'),(90,'${other}');
 CREATE TABLE positions(id bigint,tenant_id uuid);
 INSERT INTO positions VALUES(10,'${root}'),(20,'${root}'),(90,'${other}');
 CREATE TABLE "Tasks"("Id" bigint,"TenantId" uuid);
 INSERT INTO "Tasks" SELECT i+100,'${root}'::uuid FROM generate_series(1,80)i;
 CREATE TABLE migration_v40.team_id_map(source_id bigint,target_id bigint);
 INSERT INTO migration_v40.team_id_map VALUES(1,23);
 CREATE TABLE migration_v40.position_id_map(source_id bigint,target_id bigint);
 INSERT INTO migration_v40.position_id_map VALUES(1,10);
 CREATE TABLE migration_v40.task_id_map(source_id bigint,target_id bigint);
 INSERT INTO migration_v40.task_id_map SELECT i,i+100 FROM generate_series(1,80)i;
 INSERT INTO migration_source.teammembers SELECT 1,md5(i::text)::uuid,'member','2026-01-01',false FROM generate_series(1,20)i;
 INSERT INTO migration_source.user_positions SELECT md5(i::text)::uuid,1,true,'2026-01-01' FROM generate_series(1,101)i;
 INSERT INTO migration_source."TaskAssignees"("TaskId","AssigneeType","AssigneeId","AssignedAt")
 SELECT i,CASE WHEN i%2=0 THEN 'team' ELSE 'user' END,CASE WHEN i%2=0 THEN '1' ELSE md5(i::text)::uuid::text END,'2026-01-01' FROM generate_series(1,80)i;
 INSERT INTO teammembers VALUES(23,md5('1')::uuid,'old','2025-01-01',true),(90,md5('103')::uuid,'keep','2025-01-01',false);
 INSERT INTO user_positions SELECT md5(i::text)::uuid,CASE WHEN i=103 THEN 90 ELSE 20 END,true,'2025-01-01' FROM generate_series(1,103)i;
 INSERT INTO "TaskAssignmentsV2" VALUES(999,'user',md5('103')::uuid::text,'2025-01-01');
 `);
 return db;
}
{
 const db=await fixture();await db.exec(sql);
 assert.equal(Number((await db.query('SELECT count(*) n FROM teammembers')).rows[0].n),21);
 assert.equal(Number((await db.query('SELECT count(*) n FROM "TaskAssignmentsV2"')).rows[0].n),81);
 assert.equal((await db.query("SELECT is_primary p FROM user_positions WHERE user_id=md5('1')::uuid AND position_id=20")).rows[0].p,false);
 assert.equal((await db.query("SELECT is_primary p FROM user_positions WHERE user_id=md5('103')::uuid")).rows[0].p,true);
 assert.equal((await db.query("SELECT is_primary p FROM user_positions WHERE user_id=md5('102')::uuid")).rows[0].p,true);
 await assert.rejects(()=>db.exec(sql),/already committed/);await db.exec('ROLLBACK');await db.close();
 console.log('PASS: mapped memberships/positions, UUID and team assignments, primary transition, unrelated rows, rerun guard');
}
for(const change of [
 "DELETE FROM migration_v40.task_id_map WHERE source_id=1",
 `UPDATE users SET tenant_id='${other}' WHERE id=md5('1')::uuid`,
 "UPDATE migration_source.user_positions SET position_id=99 WHERE user_id=md5('1')::uuid"
]){
 const db=await fixture();await db.exec(change);await assert.rejects(()=>db.exec(sql));await db.exec('ROLLBACK');
 assert.equal(Number((await db.query('SELECT count(*) n FROM "TaskAssignmentsV2"')).rows[0].n),1);
 assert.equal((await db.query("SELECT to_regclass('migration_v40.relationships_before') r")).rows[0].r,null);
 await db.close();
}
console.log('PASS: missing mappings and cross-tenant references abort without committed writes');
{
 const db=new PGlite();
 await db.exec('CREATE SCHEMA migration_source; CREATE SCHEMA migration_v40;');
 await assert.rejects(()=>db.exec(sql),/Not a multi-tenant \(V4.1\) database/);
 await db.close();
 console.log('PASS: running against a database with no tenants table is refused.');
}
