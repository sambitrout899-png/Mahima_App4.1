-- Register the new community/ministry pages in the same page, role, package,
-- and tenant-permission architecture used by existing application pages.

INSERT INTO public.pages (key, title, description, created_at, updated_at)
VALUES
  ('EVENTS', 'Events', 'Tenant church events with visibility, RSVP, and capacity controls.', now(), now()),
  ('VOLUNTEERS', 'Volunteer Scheduling', 'Tenant volunteer shifts, staffing, and self-signup.', now(), now()),
  ('CHECKIN', 'Child Check-In', 'Tenant child check-in and guardian-matched checkout.', now(), now()),
  ('SECURITY', 'Security', 'Account multi-factor authentication and recovery settings.', now(), now()),
  ('SERVICE_PLANS', 'Service Planning', 'Tenant worship run-sheets and ordered service items.', now(), now())
ON CONFLICT (key) DO UPDATE
SET title = EXCLUDED.title,
    description = EXCLUDED.description,
    updated_at = now();

-- Defaults apply only when a tenant has not customized that role. Existing tenant
-- overrides remain untouched and can assign the new pages from the Roles screen.
WITH defaults(role_name, page_key) AS (
  VALUES
    ('admin', 'EVENTS'), ('admin', 'VOLUNTEERS'), ('admin', 'CHECKIN'),
    ('admin', 'SECURITY'), ('admin', 'SERVICE_PLANS'),
    ('member', 'EVENTS'), ('member', 'VOLUNTEERS'), ('member', 'SECURITY'),
    ('staff', 'EVENTS'), ('staff', 'VOLUNTEERS'), ('staff', 'CHECKIN'),
    ('staff', 'SECURITY'), ('staff', 'SERVICE_PLANS'),
    ('volunteer', 'EVENTS'), ('volunteer', 'VOLUNTEERS'),
    ('volunteer', 'CHECKIN'), ('volunteer', 'SECURITY'),
    ('pastor', 'EVENTS'), ('pastor', 'SECURITY'), ('pastor', 'SERVICE_PLANS')
)
INSERT INTO public.role_permissions (role_id, page_key)
SELECT role.id, defaults.page_key
FROM defaults
JOIN public.roles role ON lower(role.name) = defaults.role_name
WHERE NOT EXISTS (
  SELECT 1
  FROM public.role_permissions existing
  WHERE existing.role_id = role.id
    AND upper(existing.page_key) = defaults.page_key
);

-- Make the pages available in package drafts. Published package snapshots remain
-- immutable; root administrators can include the pages in the next package version.
CREATE TABLE IF NOT EXISTS public.subscription_plan_pages (
  plan_id uuid NOT NULL REFERENCES public.subscription_plans(id) ON DELETE CASCADE,
  page_key text NOT NULL,
  created_at_utc timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (plan_id, page_key)
);

WITH page_modules(page_key, module_code) AS (
  VALUES
    ('SECURITY', 'base'),
    ('VOLUNTEERS', 'operations'),
    ('EVENTS', 'care_ministry'),
    ('CHECKIN', 'care_ministry'),
    ('SERVICE_PLANS', 'care_ministry')
)
INSERT INTO public.subscription_plan_pages (plan_id, page_key)
SELECT plan_module.plan_id, page_modules.page_key
FROM public.subscription_plan_modules plan_module
JOIN page_modules ON page_modules.module_code = plan_module.module_code
ON CONFLICT (plan_id, page_key) DO NOTHING;
