-- DIGITAL_MARKETING is a Mahima platform operation. It must never be licensed
-- or assigned inside a customer tenant. The global page record is retained so
-- the Mahima root tenant can display and authorize it.

DELETE FROM public.tenant_role_permissions
WHERE tenant_id <> '00000000-0000-0000-0000-000000000001'::uuid
  AND upper(page_key) = 'DIGITAL_MARKETING';

DELETE FROM public.subscription_plan_pages
WHERE upper(page_key) = 'DIGITAL_MARKETING';

-- Remove stale page keys from published package snapshots. This is idempotent
-- and preserves every other package-definition field and page key.
UPDATE public.subscription_plan_publications
SET definition_json = jsonb_set(
    definition_json,
    '{pages}',
    COALESCE((
        SELECT jsonb_agg(page_key)
        FROM jsonb_array_elements_text(COALESCE(definition_json->'pages', '[]'::jsonb)) AS page(page_key)
        WHERE upper(page_key) <> 'DIGITAL_MARKETING'
    ), '[]'::jsonb),
    true
)
WHERE definition_json ? 'pages'
  AND EXISTS (
      SELECT 1
      FROM jsonb_array_elements_text(COALESCE(definition_json->'pages', '[]'::jsonb)) AS page(page_key)
      WHERE upper(page_key) = 'DIGITAL_MARKETING'
  );
