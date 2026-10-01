ALTER TABLE marketing_campaigns
  ADD COLUMN IF NOT EXISTS "DemoVideoUrl" text;

COMMENT ON COLUMN marketing_campaigns."DemoVideoUrl" IS
  'Optional publicly accessible HTTP(S) demo-video URL appended to campaign dispatch content.';
