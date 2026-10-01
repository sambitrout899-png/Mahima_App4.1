CREATE TABLE IF NOT EXISTS whatsapp_contact_states (
  "PhoneE164" text PRIMARY KEY,
  "LastInboundAtUtc" timestamptz NULL,
  "LastInboundMessageSid" text NULL,
  "LastInboundBody" text NULL,
  "ExplicitOptIn" boolean NOT NULL DEFAULT false,
  "OptedInAtUtc" timestamptz NULL,
  "OptedOut" boolean NOT NULL DEFAULT false,
  "OptedOutAtUtc" timestamptz NULL,
  "LastOutboundMessageSid" text NULL,
  "LastOutboundStatus" text NULL,
  "LastOutboundStatusAtUtc" timestamptz NULL,
  "UpdatedAtUtc" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_whatsapp_contact_states_message_sid
  ON whatsapp_contact_states ("LastInboundMessageSid")
  WHERE "LastInboundMessageSid" IS NOT NULL;

COMMENT ON TABLE whatsapp_contact_states IS
  'Channel-level WhatsApp session and explicit START/STOP consent state populated only by signed Twilio inbound webhooks.';
