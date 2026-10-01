\set ON_ERROR_STOP on
\pset pager off
BEGIN;
SET LOCAL TIME ZONE 'UTC';
SET LOCAL lock_timeout='10s';
DO $$ BEGIN
 IF to_regclass('public.tenants') IS NULL THEN RAISE EXCEPTION 'Not a multi-tenant (V4.1) database - refusing to run here'; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.tenants WHERE id='00000000-0000-0000-0000-000000000001'::uuid AND slug='mahima-root') THEN
   RAISE EXCEPTION 'Mahima Root tenant not found with the expected id/slug - refusing to run';
 END IF;
 IF to_regclass('migration_v40.journal_entry_id_map') IS NOT NULL THEN RAISE EXCEPTION 'Finance already committed'; END IF;
 IF to_regclass('migration_v40.account_id_map') IS NULL THEN RAISE EXCEPTION 'Account mappings required'; END IF;
END $$;
LOCK TABLE public.accounts,public.journal_entries,public.journal_lines,public.expenses IN ACCESS EXCLUSIVE MODE;
CREATE TEMP TABLE source_entries AS SELECT * FROM migration_source.journal_entries;
CREATE TEMP TABLE source_lines AS SELECT * FROM migration_source.journal_lines;
CREATE TEMP TABLE source_expenses AS SELECT * FROM migration_source.expenses;
CREATE TABLE migration_v40.journal_entries_before AS SELECT * FROM public.journal_entries;
CREATE TABLE migration_v40.journal_lines_before AS SELECT * FROM public.journal_lines;
CREATE TABLE migration_v40.expenses_before AS SELECT * FROM public.expenses;
DO $$
DECLARE source_entry_count integer; source_line_count integer; source_expense_count integer;
        target_entry_count integer; target_line_count integer;
BEGIN
 SELECT count(*) INTO source_entry_count FROM source_entries;
 SELECT count(*) INTO source_line_count FROM source_lines;
 SELECT count(*) INTO source_expense_count FROM source_expenses;
 SELECT count(*) INTO target_entry_count FROM public.journal_entries;
 SELECT count(*) INTO target_line_count FROM public.journal_lines;
 IF source_entry_count = 0 AND source_expense_count = 0 THEN RAISE EXCEPTION 'No source rows found - refusing to run against an empty source snapshot'; END IF;
 RAISE NOTICE 'Journal entries: % source / % target. Lines: % source / % target. Expenses: % source', source_entry_count, target_entry_count, source_line_count, target_line_count, source_expense_count;
 -- Expenses has no collision-remap logic at all (identity id map only) - unlike every other
 -- table here, so it deliberately still refuses outright rather than guess if the target already
 -- has any expense rows by the time this actually runs.
 IF EXISTS(SELECT 1 FROM public.expenses) THEN RAISE EXCEPTION 'Destination expenses table is not empty - this script has no expense collision handling, review before proceeding'; END IF;
 IF EXISTS(SELECT 1 FROM source_lines s LEFT JOIN source_entries e ON e.id=s.journal_entry_id LEFT JOIN migration_v40.account_id_map a ON a.source_id=s.account_id LEFT JOIN public.accounts t ON t.id=a.target_id WHERE e.id IS NULL OR t.id IS NULL OR t.tenant_id IS DISTINCT FROM '00000000-0000-0000-0000-000000000001'::uuid) THEN RAISE EXCEPTION 'Missing or non-root finance reference'; END IF;
END $$;
-- Reuse a journal only when its header AND complete line set match by mapped ID/value.
-- Otherwise preserve the existing journal intact and allocate a separate source journal.
CREATE TEMP TABLE reusable_entries AS
SELECT s.id FROM source_entries s JOIN public.journal_entries t USING(id)
WHERE t.tenant_id='00000000-0000-0000-0000-000000000001'
 AND to_jsonb(s)=(to_jsonb(t)-'tenant_id')
 AND (SELECT count(*) FROM source_lines l WHERE l.journal_entry_id=s.id)=(SELECT count(*) FROM public.journal_lines l WHERE l.journal_entry_id=t.id)
 AND NOT EXISTS(SELECT 1 FROM source_lines l JOIN migration_v40.account_id_map a ON a.source_id=l.account_id
  LEFT JOIN public.journal_lines d ON d.id=l.id
  WHERE l.journal_entry_id=s.id AND (d.id IS NULL OR d.journal_entry_id IS DISTINCT FROM t.id OR d.account_id IS DISTINCT FROM a.target_id OR d.debit IS DISTINCT FROM l.debit OR d.credit IS DISTINCT FROM l.credit));
CREATE TABLE migration_v40.journal_entry_id_map(source_id bigint PRIMARY KEY,target_id bigint NOT NULL UNIQUE,action text NOT NULL);
INSERT INTO migration_v40.journal_entry_id_map
SELECT s.id,CASE WHEN r.id IS NOT NULL OR t.id IS NULL THEN s.id ELSE greatest((SELECT max(id) FROM source_entries),(SELECT max(id) FROM public.journal_entries))+row_number() OVER(ORDER BY s.id) END,
CASE WHEN r.id IS NOT NULL THEN 'reuse_identical_journal' ELSE 'insert' END
FROM source_entries s LEFT JOIN reusable_entries r USING(id) LEFT JOIN public.journal_entries t USING(id);
INSERT INTO public.journal_entries(id,date,description,created_at,tenant_id)
SELECT m.target_id,s.date,s.description,s.created_at,'00000000-0000-0000-0000-000000000001'
FROM source_entries s JOIN migration_v40.journal_entry_id_map m ON m.source_id=s.id WHERE m.action='insert';
CREATE TABLE migration_v40.journal_line_id_map(source_id bigint PRIMARY KEY,target_id bigint NOT NULL UNIQUE,action text NOT NULL);
INSERT INTO migration_v40.journal_line_id_map
SELECT s.id,CASE WHEN e.action='reuse_identical_journal' OR t.id IS NULL THEN s.id ELSE greatest((SELECT max(id) FROM source_lines),(SELECT max(id) FROM public.journal_lines))+row_number() OVER(ORDER BY s.id) END,
CASE WHEN e.action='reuse_identical_journal' THEN 'reuse_identical' ELSE 'insert' END
FROM source_lines s JOIN migration_v40.journal_entry_id_map e ON e.source_id=s.journal_entry_id LEFT JOIN public.journal_lines t ON t.id=s.id;
INSERT INTO public.journal_lines(id,journal_entry_id,account_id,debit,credit)
SELECT m.target_id,e.target_id,a.target_id,s.debit,s.credit FROM source_lines s
JOIN migration_v40.journal_line_id_map m ON m.source_id=s.id
JOIN migration_v40.journal_entry_id_map e ON e.source_id=s.journal_entry_id
JOIN migration_v40.account_id_map a ON a.source_id=s.account_id WHERE m.action='insert';
CREATE TABLE migration_v40.expense_id_map(source_id bigint PRIMARY KEY,target_id bigint NOT NULL UNIQUE);
INSERT INTO migration_v40.expense_id_map SELECT id,id FROM source_expenses;
INSERT INTO public.expenses(id,description,category,amount,date,vendor,notes,payroll_person,payroll_month,created_at,updated_at,created_by_user_id,tenant_id)
SELECT id,description,category,amount,date,vendor,notes,payroll_person,payroll_month,created_at,updated_at,created_by_user_id,'00000000-0000-0000-0000-000000000001' FROM source_expenses;
DO $$
DECLARE source_entry_count integer; source_line_count integer;
BEGIN
 IF EXISTS(SELECT 1 FROM migration_v40.journal_entries_before b LEFT JOIN public.journal_entries t USING(id) WHERE to_jsonb(b) IS DISTINCT FROM to_jsonb(t)) OR
    EXISTS(SELECT 1 FROM migration_v40.journal_lines_before b LEFT JOIN public.journal_lines t USING(id) WHERE to_jsonb(b) IS DISTINCT FROM to_jsonb(t)) THEN RAISE EXCEPTION 'Pre-existing journal data changed'; END IF;
 IF EXISTS(SELECT 1 FROM source_entries s JOIN migration_v40.journal_entry_id_map m ON m.source_id=s.id LEFT JOIN public.journal_entries t ON t.id=m.target_id WHERE (to_jsonb(s)-'id') IS DISTINCT FROM (to_jsonb(t)-ARRAY['id','tenant_id']) OR t.tenant_id IS DISTINCT FROM '00000000-0000-0000-0000-000000000001'::uuid) THEN RAISE EXCEPTION 'Journal header reconciliation failed'; END IF;
 IF EXISTS(SELECT 1 FROM source_lines s JOIN migration_v40.journal_line_id_map m ON m.source_id=s.id JOIN migration_v40.journal_entry_id_map e ON e.source_id=s.journal_entry_id JOIN migration_v40.account_id_map a ON a.source_id=s.account_id LEFT JOIN public.journal_lines t ON t.id=m.target_id WHERE t.id IS NULL OR t.journal_entry_id IS DISTINCT FROM e.target_id OR t.account_id IS DISTINCT FROM a.target_id OR t.debit IS DISTINCT FROM s.debit OR t.credit IS DISTINCT FROM s.credit) THEN RAISE EXCEPTION 'Journal line reconciliation failed'; END IF;
 IF EXISTS(SELECT 1 FROM source_expenses s LEFT JOIN public.expenses t USING(id) WHERE to_jsonb(s) IS DISTINCT FROM (to_jsonb(t)-'tenant_id') OR t.tenant_id IS DISTINCT FROM '00000000-0000-0000-0000-000000000001'::uuid) THEN RAISE EXCEPTION 'Expense reconciliation failed'; END IF;
 SELECT count(*) INTO source_entry_count FROM source_entries;
 SELECT count(*) INTO source_line_count FROM source_lines;
 IF (SELECT count(*) FROM migration_v40.journal_entry_id_map)<>source_entry_count OR
    (SELECT count(*) FROM migration_v40.journal_line_id_map)<>source_line_count OR
    (SELECT count(*) FROM public.expenses)<>(SELECT count(*) FROM source_expenses) THEN RAISE EXCEPTION 'Finance mapping count mismatch'; END IF;
END $$;
CREATE TABLE migration_v40.finance_totals AS
SELECT (SELECT sum(debit) FROM source_lines) AS source_debit,
 (SELECT sum(credit) FROM source_lines) AS source_credit,
 (SELECT sum(t.debit) FROM public.journal_lines t JOIN migration_v40.journal_line_id_map m ON m.target_id=t.id) AS mapped_debit,
 (SELECT sum(t.credit) FROM public.journal_lines t JOIN migration_v40.journal_line_id_map m ON m.target_id=t.id) AS mapped_credit,
 (SELECT sum(amount) FROM source_expenses) AS source_expenses,
 (SELECT sum(amount) FROM public.expenses t JOIN migration_v40.expense_id_map m ON m.target_id=t.id) AS mapped_expenses;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM migration_v40.finance_totals WHERE source_debit IS DISTINCT FROM mapped_debit OR source_credit IS DISTINCT FROM mapped_credit OR source_expenses IS DISTINCT FROM mapped_expenses) THEN RAISE EXCEPTION 'Financial totals differ'; END IF; END $$;
DO $$
DECLARE tbl text; seq regclass; old_value bigint; called boolean; max_id bigint; step bigint; next_id numeric;
BEGIN
 FOREACH tbl IN ARRAY ARRAY['journal_entries','journal_lines','expenses'] LOOP
  seq:=pg_get_serial_sequence(format('public.%I',tbl),'id')::regclass;
  IF seq IS NULL THEN RAISE EXCEPTION 'Missing sequence for %',tbl; END IF;
  SELECT seqincrement INTO step FROM pg_sequence WHERE seqrelid=seq;
  IF step<>1 THEN RAISE EXCEPTION 'Unexpected sequence increment'; END IF;
  EXECUTE format('SELECT last_value,is_called FROM %s',seq) INTO old_value,called;
  EXECUTE format('SELECT max(id) FROM public.%I',tbl) INTO max_id;
  next_id:=greatest(max_id::numeric+1,old_value::numeric+CASE WHEN called THEN 1 ELSE 0 END);
  IF next_id>9223372036854775807 THEN RAISE EXCEPTION 'Sequence overflow'; END IF;
  EXECUTE format('ALTER SEQUENCE %s RESTART WITH %s',seq,next_id);
 END LOOP;
END $$;
SELECT * FROM migration_v40.finance_totals;
SELECT 'journal_entries' AS table_name,action,count(*) FROM migration_v40.journal_entry_id_map GROUP BY action
UNION ALL SELECT 'journal_lines',action,count(*) FROM migration_v40.journal_line_id_map GROUP BY action;
COMMIT;
\echo 'Finance migration committed.'
