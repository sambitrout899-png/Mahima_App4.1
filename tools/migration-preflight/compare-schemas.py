"""Compare local pg_dump schema exports without connecting to a database.

Targets the ordinary CREATE TABLE/ALTER TABLE formatting in these exports;
not a general SQL parser. Fails if table/column declarations are unrecognized.
"""
from pathlib import Path
import csv
import json
import re

ROOT = Path(__file__).resolve().parents[2]
INPUT = ROOT / 'migration-output' / 'preflight'
IDENT = r'(?:"(?:[^"]|"")+"|[A-Za-z_][A-Za-z_0-9]*)'

def unquote(value):
    return value[1:-1].replace('""', '"') if value.startswith('"') else value

def read_schema(path):
    sql = path.read_text(encoding='utf-8')
    tables = {}
    pattern = rf'^CREATE TABLE public\.({IDENT}) \(\n(.*?)\n\);'
    for m in re.finditer(pattern, sql, re.M | re.S):
        name, body = unquote(m[1]), m[2]
        columns = {}
        for line in body.splitlines():
            if line.strip().startswith('CONSTRAINT '):
                continue
            col = re.fullmatch(rf'    ({IDENT}) (.*?)(?:,)?', line)
            if not col:
                raise ValueError(f'Unparsed column in {name}: {line}')
            columns[unquote(col[1])] = col[2]
        tables[name] = columns
    if len(tables) != len(re.findall(r'^CREATE TABLE ', sql, re.M)):
        raise ValueError('Unparsed table declarations or non-public tables')
    constraints = {}
    for m in re.finditer(rf'ALTER TABLE ONLY public\.({IDENT})\n    ADD CONSTRAINT ({IDENT}) (.*?);', sql, re.S):
        constraints.setdefault(unquote(m[1]), []).append(m[3])
    identities = [(unquote(m[1]), unquote(m[2])) for m in re.finditer(
        rf'ALTER TABLE public\.({IDENT}) ALTER COLUMN ({IDENT}) ADD GENERATED', sql)]
    return sql, tables, constraints, identities

a_sql, a, a_cons, a_ids = read_schema(INPUT / 'v40-schema.sql')
b_sql, b, b_cons, b_ids = read_schema(INPUT / 'v41-schema.sql')
common = sorted(a.keys() & b.keys())
diffs = {}
for table in common:
    diffs[table] = {
        'source_only': {k: a[table][k] for k in a[table].keys() - b[table].keys()},
        'target_only': {k: b[table][k] for k in b[table].keys() - a[table].keys()},
        'changed': {k: {'source': a[table][k], 'target': b[table][k]}
                    for k in sorted(a[table].keys() & b[table].keys()) if a[table][k] != b[table][k]},
        'target_constraints': b_cons.get(table, []),
        'target_identity': [c for t, c in b_ids if t == table],
    }
result = {'source_tables': len(a), 'target_tables': len(b), 'common_count': len(common),
          'source_only_tables': sorted(a.keys() - b.keys()),
          'target_only_tables': sorted(b.keys() - a.keys()), 'tables': diffs}
(INPUT / 'schema-comparison.json').write_text(json.dumps(result, indent=2, sort_keys=True), encoding='utf-8')
lines = ['# Live schema comparison', '',
         'Generated from the two user-supplied schema-only exports. No database connections or writes.', '',
         f'- Source tables: {len(a)}; target tables: {len(b)}; shared tables: {len(common)}.',
         '- Source-only tables: ' + ', '.join(result['source_only_tables']),
         '- Target-only tables: ' + ', '.join(result['target_only_tables']), '',
         '## Shared-table mapping', '',
         '| Table | Source-only columns | Target-only columns | Changed declarations | Identity columns |',
         '|---|---|---|---|---|']
for t, d in diffs.items():
    lines.append('| ' + ' | '.join([t, ', '.join(sorted(d['source_only'])) or '-',
        ', '.join(sorted(d['target_only'])) or '-', ', '.join(d['changed']) or '-',
        ', '.join(d['target_identity']) or '-']) + ' |')
lines += ['', '## Declaration differences', '']
for t, d in diffs.items():
    if d['changed'] or d['source_only']:
        lines += [f'### {t}', '']
        for c, decl in sorted(d['source_only'].items()):
            lines.append(f'- Source-only `{c}`: `{decl}`')
        for c, change in d['changed'].items():
            lines.append(f"- `{c}`: `{change['source']}` → `{change['target']}`")
        lines.append('')
(INPUT / 'schema-comparison.md').write_text('\n'.join(lines) + '\n', encoding='utf-8')

def ident(value):
    return '"' + value.replace('"', '""') + '"'

def literal(value):
    return "'" + value.replace("'", "''") + "'"

# Exact counts for all tables in the inspected dumps. A schema change fails the
# script rather than silently excluding the missing table. No row contents export.
for version, tables in [('v40', a), ('v41', b)]:
    selects = []
    for name, cols in sorted(tables.items()):
        tenant = next((c for c in cols if c in ('tenant_id', 'TenantId')), None)
        if tenant:
            q = ident(tenant)
            metrics = (f"count(*) FILTER (WHERE {q} = '00000000-0000-0000-0000-000000000001'::uuid) AS root_rows, "
                       f"count(*) FILTER (WHERE {q} <> '00000000-0000-0000-0000-000000000001'::uuid) AS other_tenant_rows, "
                       f"count(*) FILTER (WHERE {q} IS NULL) AS unassigned_rows")
        else:
            metrics = 'NULL::bigint AS root_rows, NULL::bigint AS other_tenant_rows, NULL::bigint AS unassigned_rows'
        selects.append(f'SELECT {literal(name)} AS table_name, count(*) AS total_rows, {metrics} FROM public.{ident(name)}')
    query = ' UNION ALL '.join(selects) + ' ORDER BY table_name'
    script = ("\\set ON_ERROR_STOP on\n"
              "-- Exact counts only; no application writes or row-content export.\n"
              "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\n"
              "SET LOCAL lock_timeout = '5s';\n"
              "SET LOCAL statement_timeout = '15min';\n"
              f"\\copy ({query}) TO '/tmp/mahima-{version}-table-inventory.csv' WITH (FORMAT csv, HEADER true)\n"
              "ROLLBACK;\n")
    (INPUT / f'inventory-{version}.sql').write_text(script, encoding='utf-8')
print(json.dumps({k: v for k, v in result.items() if k != 'tables'}, indent=2))
for t, d in diffs.items():
    if d['source_only'] or d['changed']:
        print(t, json.dumps({k: d[k] for k in ('source_only', 'changed')}, sort_keys=True))

inventory_paths = [INPUT / f'{v}-table-inventory.csv' for v in ('v40', 'v41')]
if all(p.exists() for p in inventory_paths):
    inventories = []
    for path, schema in zip(inventory_paths, (a, b)):
        with path.open(encoding='utf-8-sig', newline='') as stream:
            records = list(csv.DictReader(stream))
        if len(records) != len(schema) or {r['table_name'] for r in records} != set(schema):
            raise ValueError(f'Incomplete or duplicate inventory: {path}')
        inventory = {r['table_name']: {k: int(v) if v else None for k, v in r.items() if k != 'table_name'} for r in records}
        for name, counts in inventory.items():
            if counts['root_rows'] is not None and sum(counts[k] for k in ('root_rows', 'other_tenant_rows', 'unassigned_rows')) != counts['total_rows']:
                raise ValueError(f'Tenant counts do not reconcile: {path}, {name}')
        inventories.append(inventory)
    src_counts, dst_counts = inventories
    missing_total = sum(src_counts[t]['total_rows'] for t in result['source_only_tables'])
    rows = ['# Live inventory comparison', '',
            'User-collected independent database snapshots; counts do not establish record identity or equality.', '',
            f'Source-only tables contain **{missing_total} rows** in total.', '',
            '| Source-only table | Source rows |', '|---|---:|']
    rows += [f"| {t} | {src_counts[t]['total_rows']} |" for t in result['source_only_tables']]
    rows += ['', '## Shared tables', '', '| Table | Source total | Target total | Target root | Target other | Target unassigned |', '|---|---:|---:|---:|---:|---:|']
    for t in common:
        d = dst_counts[t]
        rows.append('| ' + ' | '.join([t, str(src_counts[t]['total_rows'])] + [str(d[k]) if d[k] is not None else 'not directly scoped' for k in ('total_rows', 'root_rows', 'other_tenant_rows', 'unassigned_rows')]) + ' |')
    rows += ['', '## Destination-only tables to preserve', '', '| Table | Existing rows |', '|---|---:|']
    rows += [f"| {t} | {dst_counts[t]['total_rows']} |" for t in result['target_only_tables']]
    (INPUT / 'inventory-comparison.md').write_text('\n'.join(rows) + '\n', encoding='utf-8')
    print(f'Inventory validation passed: {len(src_counts)} source tables, {len(dst_counts)} destination tables; {missing_total} source-only rows.')
