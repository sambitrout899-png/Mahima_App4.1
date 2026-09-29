-- Appointment letter PDF generation for payroll-enabled users. The generated PDF lives
-- in a private, non-web-exposed, tenant-scoped directory (see IAppointmentLetterService);
-- this just records the relative path + generation time against the user, mirroring how
-- CertificatePdfUrl attaches a baptism certificate to its baptism request.
ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS appointment_letter_url text NULL,
    ADD COLUMN IF NOT EXISTS appointment_letter_generated_at_utc timestamptz NULL;
