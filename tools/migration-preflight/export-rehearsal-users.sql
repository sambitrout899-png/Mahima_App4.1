\set ON_ERROR_STOP on
BEGIN READ ONLY;
SET LOCAL TIME ZONE 'UTC';
SET LOCAL DateStyle = 'ISO, YMD';
DO $$ BEGIN
  IF current_database() <> 'mahima_v40_rehearsal_20260922_072439_598910' THEN
    RAISE EXCEPTION 'Export is restricted to the restored V4.0 rehearsal snapshot';
  END IF;
END $$;
\copy (SELECT to_jsonb(u) FROM public.users u ORDER BY id) TO '/var/backups/mahima-migration/rehearsal-input/users.csv' WITH (FORMAT csv)
ROLLBACK;
