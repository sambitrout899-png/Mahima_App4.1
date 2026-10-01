\set ON_ERROR_STOP on
\pset pager off
BEGIN;
SELECT 'source' side, count(*) records FROM migration_source."Meetings";
SELECT 'target' side, count(*) records FROM public."Meetings";
ROLLBACK;
