ALTER TABLE public.tenants
ADD COLUMN IF NOT EXISTS country_code varchar(2) NOT NULL DEFAULT 'IN';

UPDATE public.tenants
SET country_code = upper(country_code)
WHERE country_code IS NOT NULL;

-- Existing installations are Indian unless explicitly changed by Root Admin.
UPDATE public.tenants SET country_code = 'IN'
WHERE country_code IS NULL OR btrim(country_code) = '';

UPDATE public.chats AS chat
SET name = CASE WHEN upper(tenant.country_code) = 'IN' THEN 'Jai Masih' ELSE 'Praise The Lord' END
FROM public.tenants AS tenant
WHERE chat.tenant_id = tenant.id
  AND chat.isgroup = true
  AND lower(chat.name) IN ('jai masih', 'praise the lord');
