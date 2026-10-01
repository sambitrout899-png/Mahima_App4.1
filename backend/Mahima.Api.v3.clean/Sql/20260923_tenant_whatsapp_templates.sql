-- Per-tenant WhatsApp (Twilio Content SID) template configuration.
-- Falls back to Helpers.TwilioTemplateDefaults when a tenant hasn't set its own value.
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS whatsapp_user_notification_template_sid varchar(64);
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS whatsapp_marketing_template_sid varchar(64);
