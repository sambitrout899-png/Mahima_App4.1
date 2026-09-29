ALTER TABLE public.appointment_letters
    ADD COLUMN IF NOT EXISTS language varchar(8) NOT NULL DEFAULT 'en';
