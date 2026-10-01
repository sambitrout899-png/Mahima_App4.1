\set ON_ERROR_STOP on
-- Run with psql on V4.0. Exports identifiers, deletion state and key fingerprints.
-- The CSV remains sensitive audit material; hashes are not anonymization.
-- No application writes. Keep the following \copy command on a single line.
\copy (SELECT id, isdeleted, md5("UserCode"::text) AS usercode_hash, md5(NULLIF(CASE WHEN length(digits) > 10 AND digits LIKE '91%' THEN right(digits, 10) ELSE digits END, '')) AS phone_hash FROM (SELECT id, isdeleted, "UserCode", regexp_replace(COALESCE(phone, ''), '\D', '', 'g') AS digits FROM public.users) s ORDER BY id) TO '/tmp/mahima-v40-user-keys.csv' WITH (FORMAT csv, HEADER true)
