import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {PGlite} from '../../tmp/storage-sql-test/node_modules/@electric-sql/pglite/dist/index.js';
const root='00000000-0000-0000-0000-000000000001';
for(const name of ['attendance','sermons','timesheets','payroll','prayer-requests']) {
 const raw=readFileSync(`tools/migration-preflight/recovery-rehearse-${name}.sql`,'utf8');
 const update=raw.match(/UPDATE public\.[\s\S]*?;/)[0];
 const table=update.match(/UPDATE public\.([^ ]+)/)[1];
 const src=update.match(/FROM (\w+) s JOIN/)[1];
 const map=update.match(/JOIN migration_v40\.(\w+)/)[1];
 const id=update.match(/m.source_id=s\.([\w"]+)/)[1];
 const tenant=update.match(/AND t\.([\w"]+)='/)[1];
 const fields=[...update.matchAll(/(?:SET |,)([\w"]+)=s\./g)].map(m=>m[1]);
 const db=new PGlite();
 await db.exec(`CREATE SCHEMA migration_v40; CREATE TABLE public.${table}(${id} int PRIMARY KEY,${tenant} uuid,${fields.map(f=>`${f} text`).join(',')}); CREATE TABLE ${src}(${id} int,${fields.map(f=>`${f} text`).join(',')}); CREATE TABLE migration_v40.${map}(source_id int,target_id int,action text);`);
 for(let i=1;i<=4;i++) await db.exec(`INSERT INTO public.${table} VALUES(${i},'${i===3?'00000000-0000-0000-0000-000000000002':root}',${fields.map(()=>`'old${i}'`).join(',')});`);
 for(let i=1;i<=2;i++) await db.exec(`INSERT INTO ${src} VALUES(${i},${fields.map(()=>`'new${i}'`).join(',')}); INSERT INTO migration_v40.${map} VALUES(${i},${i},'reuse_root');`);
 await db.exec(update);
 const rows=(await db.query(`SELECT * FROM public.${table} ORDER BY ${id}`)).rows;
 for(let i=0;i<4;i++) for(const f of fields) assert.equal(rows[i][f.replaceAll('"','')],i<2?`new${i+1}`:`old${i+1}`,`${name}: wrong row updated`);
 console.log(`PASS ${name}: correct mapped values; other tenant and extra root preserved`);
 await db.close();
}
