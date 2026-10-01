-- Adds TOTP-based multi-factor authentication columns to users.
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS mfa_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS mfa_secret varchar(64) NULL;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS mfa_pending_secret varchar(64) NULL;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS mfa_recovery_codes text NULL; -- comma-separated, one-time use
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS mfa_enabled_at_utc timestamptz NULL;
