ALTER TABLE marketing_prospects
  ADD COLUMN IF NOT EXISTS "Denomination" text;

CREATE INDEX IF NOT EXISTS ix_marketing_prospect_country ON marketing_prospects("Country");

ALTER TABLE marketing_campaigns
  ADD COLUMN IF NOT EXISTS "Language" text NOT NULL DEFAULT 'English',
  ADD COLUMN IF NOT EXISTS "WhatsAppContentSid" text,
  ADD COLUMN IF NOT EXISTS "WhatsAppContentVariablesJson" jsonb NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS ix_marketing_outreach_channel_status ON marketing_outreach("Channel","Status");

COMMENT ON COLUMN marketing_prospects."Denomination" IS
  'Optional church/ministry denomination or tradition, used for audience segmentation.';
COMMENT ON COLUMN marketing_campaigns."Language" IS
  'Language the AI-drafted campaign copy was written in; descriptive/filterable only.';
COMMENT ON COLUMN marketing_campaigns."WhatsAppContentSid" IS
  'Twilio approved Content Template SID required for cold WhatsApp business-initiated outreach.';
COMMENT ON COLUMN marketing_campaigns."WhatsAppContentVariablesJson" IS
  'Maps Twilio Content Template variable positions (e.g. "1","2") to merge-token expressions.';
