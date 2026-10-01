\set ON_ERROR_STOP on
\pset pager off
BEGIN;
SELECT "Id", "OwnerType", "OwnerId", "S3Key", "Filename" FROM public."Attachments" ORDER BY "Id";
ROLLBACK;
