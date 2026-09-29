-- Promotes the appointment letter's input fields (department, reporting manager,
-- appointment date, additional terms, salary type) from transient request data into
-- a proper editable record per user, with the generated PDF attached to that same
-- record (pdf_url/generated_at_utc) rather than only mirrored onto users.*.
CREATE TABLE IF NOT EXISTS public.appointment_letters (
    id bigserial PRIMARY KEY,
    tenant_id uuid NOT NULL,
    user_id uuid NOT NULL,
    department text NULL,
    reporting_manager_user_id uuid NULL,
    appointment_date timestamptz NULL,
    additional_terms text NULL,
    salary_type varchar(16) NULL,
    pdf_url text NULL,
    generated_at_utc timestamptz NULL,
    created_at_utc timestamptz NOT NULL DEFAULT now(),
    updated_at_utc timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, user_id)
);
