-- Tenant Landing Page rebuild: unified branding, draft/publish workflow, version history,
-- richer theming + SEO fields. Idempotent — safe to re-run.

-- 1. Unified branding — single source of truth shared by the Landing Page and Print Templates.
CREATE TABLE IF NOT EXISTS public.tenant_branding (
    tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
    logo_url text NULL,
    primary_color varchar(32) NOT NULL DEFAULT '#0f766e',
    accent_color varchar(32) NOT NULL DEFAULT '#f59e0b',
    neutral_color varchar(32) NOT NULL DEFAULT '#f8fafc',
    dark_color varchar(32) NOT NULL DEFAULT '#0f172a',
    heading_font varchar(80) NOT NULL DEFAULT 'Inter',
    body_font varchar(80) NOT NULL DEFAULT 'Inter',
    contact_email varchar(256) NULL,
    contact_phone varchar(32) NULL,
    address text NULL,
    social_links_json jsonb NOT NULL DEFAULT '[]',
    created_at_utc timestamptz NOT NULL DEFAULT now(),
    updated_at_utc timestamptz NOT NULL DEFAULT now()
);

-- Backfill from existing landing config data (first save wins; safe to re-run).
INSERT INTO public.tenant_branding (tenant_id, logo_url, primary_color, accent_color, contact_email, contact_phone, address, social_links_json, created_at_utc, updated_at_utc)
SELECT tenant_id, logo_url,
       COALESCE(NULLIF(primary_color, ''), '#0f766e'),
       COALESCE(NULLIF(accent_color, ''), '#f59e0b'),
       contact_email, contact_phone, address,
       COALESCE(social_links_json, '[]'::jsonb),
       now(), now()
FROM public.tenant_landing_configs
ON CONFLICT (tenant_id) DO NOTHING;

-- 2. Extend the live landing config with hero layout + SEO fields.
ALTER TABLE public.tenant_landing_configs
    ADD COLUMN IF NOT EXISTS hero_layout varchar(32) NOT NULL DEFAULT 'split-card',
    ADD COLUMN IF NOT EXISTS seo_title varchar(220) NULL,
    ADD COLUMN IF NOT EXISTS seo_description varchar(400) NULL,
    ADD COLUMN IF NOT EXISTS og_image_url text NULL;

-- Old branding columns (logo_url/primary_color/accent_color/contact_email/contact_phone/address/social_links_json)
-- are intentionally left in place, unused going forward — safer rollback; drop in a later cleanup pass.

-- 3. Draft table — all admin edits land here first, never touching the live row directly.
CREATE TABLE IF NOT EXISTS public.tenant_landing_drafts (
    tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
    hero_title varchar(220) NOT NULL,
    hero_subtitle text NULL,
    hero_image_url text NULL,
    hero_layout varchar(32) NOT NULL DEFAULT 'split-card',
    service_times_json jsonb NOT NULL DEFAULT '[]',
    sections_json jsonb NOT NULL DEFAULT '[]',
    seo_title varchar(220) NULL,
    seo_description varchar(400) NULL,
    og_image_url text NULL,
    updated_at_utc timestamptz NOT NULL DEFAULT now(),
    updated_by_user_id uuid NULL
);

-- Seed each tenant's draft from its current live content (safe to re-run; only fires once per tenant).
INSERT INTO public.tenant_landing_drafts (tenant_id, hero_title, hero_subtitle, hero_image_url, hero_layout, service_times_json, sections_json, seo_title, seo_description, og_image_url, updated_at_utc)
SELECT tenant_id, hero_title, hero_subtitle, hero_image_url, hero_layout,
       COALESCE(service_times_json, '[]'::jsonb), COALESCE(sections_json, '[]'::jsonb),
       seo_title, seo_description, og_image_url, now()
FROM public.tenant_landing_configs
ON CONFLICT (tenant_id) DO NOTHING;

-- 4. Version history — append-only, pruned to the last 20 per tenant by the application on publish.
CREATE TABLE IF NOT EXISTS public.tenant_landing_versions (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    snapshot_json jsonb NOT NULL,
    published_at_utc timestamptz NOT NULL DEFAULT now(),
    published_by_user_id uuid NULL
);
CREATE INDEX IF NOT EXISTS ix_tenant_landing_versions_tenant_published ON public.tenant_landing_versions(tenant_id, published_at_utc DESC);
