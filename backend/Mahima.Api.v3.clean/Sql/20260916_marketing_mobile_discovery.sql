ALTER TABLE marketing_prospects
  ADD COLUMN IF NOT EXISTS "State" text,
  ADD COLUMN IF NOT EXISTS "City" text;
ALTER TABLE marketing_discovery_schedules
  ADD COLUMN IF NOT EXISTS "ContactFocus" text NOT NULL DEFAULT 'all';
CREATE INDEX IF NOT EXISTS ix_marketing_prospect_geography ON marketing_prospects("Country", "State", "City");
CREATE INDEX IF NOT EXISTS ix_marketing_prospect_phone ON marketing_prospects("PublicPhone");
CREATE INDEX IF NOT EXISTS ix_marketing_prospect_whatsapp ON marketing_prospects("PublicWhatsapp");
