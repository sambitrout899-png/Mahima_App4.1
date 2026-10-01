CREATE TABLE IF NOT EXISTS marketing_prospects (
  "Id" uuid PRIMARY KEY, "OrganizationName" text NOT NULL, "Country" text, "Website" text,
  "ContactName" text, "PublicEmail" text, "PublicPhone" text, "PublicWhatsapp" text,
  "SourceUrl" text, "SourceRetrievedAtUtc" timestamptz, "ContactBasis" text NOT NULL,
  "ConsentStatus" text NOT NULL, "DoNotContact" boolean NOT NULL DEFAULT false,
  "Status" text NOT NULL, "Score" integer NOT NULL DEFAULT 0, "AiSummary" text,
  "ReviewedByUserId" uuid, "ReviewedAtUtc" timestamptz, "CreatedAtUtc" timestamptz NOT NULL,
  "UpdatedAtUtc" timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS marketing_campaigns (
  "Id" uuid PRIMARY KEY, "Name" text NOT NULL, "Objective" text NOT NULL,
  "ChannelsJson" jsonb NOT NULL DEFAULT '[]', "AudienceJson" jsonb NOT NULL DEFAULT '{}',
  "SubjectTemplate" text NOT NULL, "BodyTemplate" text NOT NULL, "SocialTemplate" text NOT NULL,
  "Status" text NOT NULL, "IntervalDays" integer NOT NULL DEFAULT 30, "NextRunAtUtc" timestamptz,
  "ApprovedAtUtc" timestamptz, "ApprovedByUserId" uuid, "CreatedAtUtc" timestamptz NOT NULL,
  "UpdatedAtUtc" timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS marketing_outreach (
  "Id" uuid PRIMARY KEY, "CampaignId" uuid NOT NULL REFERENCES marketing_campaigns("Id") ON DELETE CASCADE,
  "ProspectId" uuid NOT NULL REFERENCES marketing_prospects("Id") ON DELETE CASCADE,
  "Channel" text NOT NULL, "Status" text NOT NULL, "ExternalMessageId" text, "FailureReason" text,
  "SentAtUtc" timestamptz, "RespondedAtUtc" timestamptz, "CreatedAtUtc" timestamptz NOT NULL,
  UNIQUE ("CampaignId","ProspectId","Channel")
);
CREATE TABLE IF NOT EXISTS marketing_leads (
  "Id" uuid PRIMARY KEY, "ProspectId" uuid NOT NULL UNIQUE REFERENCES marketing_prospects("Id"),
  "Stage" text NOT NULL, "Score" integer NOT NULL DEFAULT 0, "QualificationNotes" text,
  "OwnerUserId" uuid, "NextActionAtUtc" timestamptz, "CreatedAtUtc" timestamptz NOT NULL,
  "UpdatedAtUtc" timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS marketing_quotes (
  "Id" uuid PRIMARY KEY, "LeadId" uuid NOT NULL REFERENCES marketing_leads("Id") ON DELETE CASCADE,
  "QuoteNumber" text NOT NULL UNIQUE, "Currency" text NOT NULL, "Amount" numeric(14,2) NOT NULL,
  "LineItemsJson" jsonb NOT NULL DEFAULT '[]', "Status" text NOT NULL, "ValidUntilUtc" timestamptz NOT NULL,
  "ApprovedAtUtc" timestamptz, "SentAtUtc" timestamptz, "AcceptedAtUtc" timestamptz,
  "AcceptanceToken" text NOT NULL UNIQUE, "CreatedAtUtc" timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS marketing_orders (
  "Id" uuid PRIMARY KEY, "QuoteId" uuid NOT NULL UNIQUE REFERENCES marketing_quotes("Id") ON DELETE CASCADE,
  "Status" text NOT NULL, "TenantId" uuid REFERENCES public.tenants(id) ON DELETE SET NULL,
  "DemoStartsAtUtc" timestamptz, "DemoEndsAtUtc" timestamptz, "ConvertedAtUtc" timestamptz,
  "CreatedAtUtc" timestamptz NOT NULL, "UpdatedAtUtc" timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_marketing_prospect_status ON marketing_prospects("Status","DoNotContact");
CREATE INDEX IF NOT EXISTS ix_marketing_campaign_due ON marketing_campaigns("Status","NextRunAtUtc");
CREATE TABLE IF NOT EXISTS marketing_discovery_schedules (
  "Id" uuid PRIMARY KEY, "Name" text NOT NULL, "Enabled" boolean NOT NULL DEFAULT false,
  "Regions" text NOT NULL, "Languages" text NOT NULL, "MaxProspectsPerRun" integer NOT NULL DEFAULT 25,
  "IntervalDays" integer NOT NULL DEFAULT 7, "NextRunAtUtc" timestamptz, "LastRunAtUtc" timestamptz,
  "ApprovedByUserId" uuid, "ApprovedAtUtc" timestamptz, "CreatedAtUtc" timestamptz NOT NULL,
  "UpdatedAtUtc" timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS marketing_discovery_runs (
  "Id" uuid PRIMARY KEY, "ScheduleId" uuid REFERENCES marketing_discovery_schedules("Id") ON DELETE SET NULL,
  "Trigger" text NOT NULL, "Regions" text NOT NULL, "Status" text NOT NULL,
  "CandidatesFound" integer NOT NULL DEFAULT 0, "CandidatesImported" integer NOT NULL DEFAULT 0,
  "CandidatesSkipped" integer NOT NULL DEFAULT 0, "Provider" text, "Model" text, "Error" text,
  "StartedAtUtc" timestamptz NOT NULL, "CompletedAtUtc" timestamptz
);
CREATE INDEX IF NOT EXISTS ix_marketing_discovery_due ON marketing_discovery_schedules("Enabled","NextRunAtUtc");
CREATE INDEX IF NOT EXISTS ix_marketing_discovery_runs_started ON marketing_discovery_runs("StartedAtUtc");

ALTER TABLE marketing_outreach ADD COLUMN IF NOT EXISTS "AttemptNumber" integer NOT NULL DEFAULT 1;
ALTER TABLE marketing_outreach ADD COLUMN IF NOT EXISTS "Recipient" text;
ALTER TABLE marketing_outreach ADD COLUMN IF NOT EXISTS "RenderedSubject" text;
ALTER TABLE marketing_outreach ADD COLUMN IF NOT EXISTS "RenderedBody" text NOT NULL DEFAULT '';
ALTER TABLE marketing_outreach ADD COLUMN IF NOT EXISTS "Provider" text;
ALTER TABLE marketing_outreach ADD COLUMN IF NOT EXISTS "AttemptedAtUtc" timestamptz NOT NULL DEFAULT now();
ALTER TABLE marketing_outreach ADD COLUMN IF NOT EXISTS "CompletedAtUtc" timestamptz;
ALTER TABLE marketing_outreach DROP CONSTRAINT IF EXISTS "marketing_outreach_CampaignId_ProspectId_Channel_key";
DROP INDEX IF EXISTS "IX_marketing_outreach_CampaignId_ProspectId_Channel";
CREATE UNIQUE INDEX IF NOT EXISTS "IX_marketing_outreach_CampaignId_ProspectId_Channel_AttemptNumber"
  ON marketing_outreach("CampaignId","ProspectId","Channel","AttemptNumber");
CREATE INDEX IF NOT EXISTS "IX_marketing_outreach_Status_AttemptedAtUtc"
  ON marketing_outreach("Status","AttemptedAtUtc");

CREATE TABLE IF NOT EXISTS marketing_communication_events (
  "Id" uuid PRIMARY KEY,
  "OutreachId" uuid NOT NULL REFERENCES marketing_outreach("Id") ON DELETE CASCADE,
  "EventType" text NOT NULL,
  "EventAtUtc" timestamptz NOT NULL,
  "ProviderEventId" text,
  "LinkUrl" text,
  "IpHash" text,
  "UserAgent" text,
  "MetadataJson" jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS "IX_marketing_communication_events_OutreachId_EventAtUtc"
  ON marketing_communication_events("OutreachId", "EventAtUtc");
CREATE INDEX IF NOT EXISTS "IX_marketing_communication_events_ProviderEventId"
  ON marketing_communication_events("ProviderEventId");
