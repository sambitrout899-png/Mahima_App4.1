"""Generate rehearsal-only key/content comparisons for all remaining shared tables."""
from pathlib import Path
import re
import runpy
import json

HERE = Path(__file__).resolve().parent
schema = runpy.run_path(str(HERE / 'compare-schemas.py'))
source, target = schema['a'], schema['b']
q, lit = schema['ident'], schema['literal']
out = schema['INPUT']
tables = sorted(source.keys() & target.keys() - {'users', '__EFMigrationsHistory'})
source_selects, target_selects, metadata = [], [], {}
for table in tables:
    def pk(side):
        declaration = next(c for c in schema[side + '_cons'][table] if c.startswith('PRIMARY KEY'))
        return [schema['unquote'](s.strip()) for s in re.search(r'\((.*?)\)', declaration)[1].split(',')]
    keys = pk('b')
    added_tenant_keys = [k for k in keys if k not in source[table] and k in ('tenant_id', 'TenantId')]
    if [k for k in keys if k not in added_tenant_keys] != pk('a'):
        raise ValueError(f'Primary key changed in {table}; explicit mapping needed')
    shared = sorted(source[table].keys() & target[table].keys())
    tenant = next((c for c in target[table] if c in ('tenant_id', 'TenantId')), None)
    key_expr = 'jsonb_build_object(' + ', '.join(f'{lit(c)}, to_jsonb(t.{q(c)})' for c in keys) + ')'
    source_key_expr = 'jsonb_build_object(' + ', '.join(
        f"{lit(c)}, to_jsonb('00000000-0000-0000-0000-000000000001'::uuid)" if c in added_tenant_keys
        else f'{lit(c)}, to_jsonb(t.{q(c)})' for c in keys) + ')'
    # Project only common fields, independent of column order and target additions.
    projection = 'jsonb_build_object(' + ', '.join(f'{lit(c)}, to_jsonb(t.{q(c)})' for c in shared) + ')'
    base = f'SELECT {lit(table)} AS table_name, {key_expr} AS row_key, md5(({projection})::text) AS fingerprint'
    source_selects.append(base.replace(key_expr, source_key_expr) + f' FROM public.{q(table)} t')
    target_selects.append(base + f', {"t." + q(tenant) if tenant else "NULL::uuid"} AS tenant_id, {"true" if tenant else "false"} AS has_direct_tenant FROM public.{q(table)} t')
    metadata[table] = {'key_columns': keys, 'compared_columns': shared, 'target_tenant_column': tenant,
                       'source_columns': list(source[table]), 'target_columns': list(target[table])}

def header(db):
    return ("\\set ON_ERROR_STOP on\n\\pset pager off\nBEGIN ISOLATION LEVEL REPEATABLE READ;\n"
            "SET LOCAL TIME ZONE 'UTC';\nSET LOCAL DateStyle = 'ISO, YMD';\n"
            "SET LOCAL lock_timeout = '10s';\nSET LOCAL statement_timeout = '15min';\n"
            f"DO $$ BEGIN IF current_database()<>{lit(db)} THEN RAISE EXCEPTION 'Wrong rehearsal database'; END IF; END $$;\n")
source_sql = header('mahima_v40_rehearsal_20260922_072439_598910')
source_sql += '\\copy (' + ' UNION ALL '.join(source_selects) + ") TO '/var/backups/mahima-migration/rehearsal-input/module-keys.csv' WITH (FORMAT csv, HEADER true)\nROLLBACK;\n"
target_sql = header('mahima_v41_rehearsal_20260922_072500_351048')
target_sql += r"""CREATE TEMP TABLE source_keys(table_name text, row_key jsonb, fingerprint text);
\copy source_keys FROM '/var/backups/mahima-migration/rehearsal-input/module-keys.csv' WITH (FORMAT csv, HEADER true)
CREATE UNIQUE INDEX source_keys_pk ON source_keys(table_name,row_key);
"""
target_sql += 'CREATE TEMP TABLE target_keys AS ' + ' UNION ALL '.join(target_selects) + ';\n'
target_sql += 'CREATE UNIQUE INDEX target_keys_pk ON target_keys(table_name,row_key);\n'
values = ','.join('(' + lit(t) + ')' for t in tables)
target_sql += f"""CREATE TEMP TABLE module_report AS
SELECT names.table_name,
       count(s.row_key) AS source_rows,
       count(s.row_key) FILTER (WHERE t.row_key IS NULL) AS new_keys,
       count(s.row_key) FILTER (WHERE t.row_key IS NOT NULL AND s.fingerprint=t.fingerprint) AS matching_keys_same_shared_fields,
       count(s.row_key) FILTER (WHERE t.row_key IS NOT NULL AND s.fingerprint<>t.fingerprint) AS matching_keys_differing_shared_fields,
       count(s.row_key) FILTER (WHERE t.has_direct_tenant AND t.tenant_id='00000000-0000-0000-0000-000000000001') AS matching_root_keys,
       count(s.row_key) FILTER (WHERE t.has_direct_tenant AND t.tenant_id IS DISTINCT FROM '00000000-0000-0000-0000-000000000001'::uuid) AS matching_other_or_unassigned_keys,
       count(s.row_key) FILTER (WHERE NOT t.has_direct_tenant) AS matching_keys_without_direct_tenant
FROM (VALUES {values}) names(table_name)
LEFT JOIN source_keys s USING(table_name)
LEFT JOIN target_keys t ON t.table_name=s.table_name AND t.row_key=s.row_key
GROUP BY names.table_name ORDER BY names.table_name;
\\copy module_report TO '/var/backups/mahima-migration/rehearsal-input/module-key-report.csv' WITH (FORMAT csv, HEADER true)
SELECT * FROM module_report WHERE matching_other_or_unassigned_keys>0 OR matching_keys_differing_shared_fields>0;
ROLLBACK;
"""
(out / 'export-module-keys.sql').write_text(source_sql, encoding='utf-8')
(out / 'check-module-keys.sql').write_text(target_sql, encoding='utf-8')
(out / 'module-preflight-metadata.json').write_text(json.dumps(metadata, indent=2), encoding='utf-8')
print(f'Generated guarded comparisons for {len(tables)} shared tables; users and migration history excluded.')
