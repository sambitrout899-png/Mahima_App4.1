INSERT INTO public.module_catalog
    (code, name, description, monthly_price_inr, is_base_module, enabled, display_order, created_at_utc, updated_at_utc)
VALUES
    ('base', 'Free Essentials', 'Home, public landing page, landing editor, users, prayer requests, sermons, and teams.', 0, true, true, 10, now(), now()),
    ('chat', 'Jai Masih Chat', 'Direct chat, group chat, voice notes, calls, and chat safety.', 499, false, true, 20, now(), now()),
    ('operations', 'Operations Suite', 'Tasks, attendance, payroll, costs, accounting, reports, and audit trail.', 799, false, true, 30, now(), now()),
    ('care_ministry', 'Care Ministry Suite', 'AI Pastor, marriage, baptism, counselling, and pastoral care workflows.', 599, false, true, 40, now(), now()),
    ('admin_tools', 'Administration Suite', 'Roles, pages, admin dashboard, live users, languages, and multi-tenant administration.', 699, false, true, 50, now(), now()),
    ('communications', 'Communications Suite', 'Message center, email, Google Drive, and server files.', 599, false, true, 60, now(), now())
ON CONFLICT (code) DO UPDATE
SET
    name = excluded.name,
    description = excluded.description,
    monthly_price_inr = excluded.monthly_price_inr,
    is_base_module = excluded.is_base_module,
    enabled = excluded.enabled,
    display_order = excluded.display_order,
    updated_at_utc = now();

UPDATE public.module_catalog
SET enabled = false, updated_at_utc = now()
WHERE code IN ('payroll', 'accounting', 'automation');
