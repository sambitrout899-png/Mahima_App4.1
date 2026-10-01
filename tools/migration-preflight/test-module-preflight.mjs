import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {PGlite} from '../../tmp/storage-sql-test/node_modules/@electric-sql/pglite/dist/index.js';
const base='migration-output/preflight/';
const metadata=JSON.parse(readFileSync(base+'module-preflight-metadata.json','utf8'));
const sourceSql=readFileSync(base+'export-module-keys.sql','utf8');
const targetSql=readFileSync(base+'check-module-keys.sql','utf8');
const q=s=>'"'+s.replaceAll('"','""')+'"';
const a=new PGlite(), b=new PGlite();
for(const [table,m] of Object.entries(metadata)) {
  for(const [db,side] of [[a,'source'],[b,'target']]) {
    await db.exec(`CREATE TABLE ${q(table)} (${m[side+'_columns'].map(c=>`${q(c)} ${c===m.target_tenant_column?'uuid':'text'}`).join(',')});`);
  }
}
await a.exec("INSERT INTO accounts(id,name) VALUES ('1','same'),('2','source'),('3','new'); INSERT INTO ministry_automation_settings(key) VALUES ('schedule');");
await b.exec("INSERT INTO accounts(id,name,tenant_id) VALUES ('1','same','00000000-0000-0000-0000-000000000001'),('2','other','00000000-0000-0000-0000-000000000002'); INSERT INTO ministry_automation_settings(key,tenant_id) VALUES ('schedule','00000000-0000-0000-0000-000000000001'),('schedule','00000000-0000-0000-0000-000000000002');");
const exportQuery=sourceSql.match(/^\\copy \((.*)\) TO /m)[1];
const rows=(await a.query(exportQuery)).rows;
const sql=targetSql.replace(/^\\.*$/gm,'').replace(/DO \$\$ BEGIN IF current_database\(\)[\s\S]*?END \$\$;/,'').replace('ROLLBACK;','');
const position=sql.indexOf('CREATE UNIQUE INDEX source_keys_pk');
await b.exec(sql.slice(0,position));
for(const row of rows) await b.query('INSERT INTO source_keys VALUES($1,$2,$3)',[row.table_name,JSON.stringify(row.row_key),row.fingerprint]);
await b.exec(sql.slice(position));
const report=(await b.query('SELECT * FROM module_report')).rows;
assert.equal(report.length,55);
const accounts=report.find(r=>r.table_name==='accounts');
for(const [key,value] of Object.entries({source_rows:3,new_keys:1,matching_keys_same_shared_fields:1,matching_keys_differing_shared_fields:1,matching_other_or_unassigned_keys:1})) assert.equal(Number(accounts[key]),value,key);
assert.equal(Number(report.find(r=>r.table_name==='ministry_automation_settings').matching_root_keys),1);
assert.equal(Number(report.find(r=>r.table_name==='ministry_automation_settings').matching_other_or_unassigned_keys),0);
await b.exec('ROLLBACK');
await a.close(); await b.close();
console.log('PASS: 55 table queries, new/identical/changed keys, cross-tenant collision, empty tables and tenant-extended composite primary key.');
