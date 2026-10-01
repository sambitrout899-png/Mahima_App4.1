ALTER TABLE public.staff_payroll_settings
    ADD COLUMN IF NOT EXISTS weekly_off_day integer NOT NULL DEFAULT 0;

ALTER TABLE public.staff_payroll_settings
    DROP CONSTRAINT IF EXISTS ck_staff_payroll_settings_weekly_off_day;

ALTER TABLE public.staff_payroll_settings
    ADD CONSTRAINT ck_staff_payroll_settings_weekly_off_day
    CHECK (weekly_off_day BETWEEN 0 AND 6);

UPDATE public."AttendanceRecords"
SET "Status" = 'Leave (Standard)'
WHERE lower(trim("Status")) = 'leave';
