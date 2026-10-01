ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS preferred_language varchar(8);

UPDATE public.users u
SET preferred_language = l.code
FROM public.app_languages l
WHERE l.is_default = TRUE
  AND l.enabled = TRUE
  AND u.preferred_language IS NULL;
