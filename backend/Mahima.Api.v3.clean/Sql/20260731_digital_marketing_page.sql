INSERT INTO public.pages (key, title, description, created_at, updated_at)
VALUES ('DIGITAL_MARKETING', 'Digital Marketing', 'Root-only prospect, campaign, lead, quotation, order and demo operations.', now(), now())
ON CONFLICT (key) DO UPDATE SET title = EXCLUDED.title, description = EXCLUDED.description, updated_at = now();
