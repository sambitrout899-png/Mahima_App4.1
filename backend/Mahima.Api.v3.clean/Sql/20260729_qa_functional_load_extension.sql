ALTER TABLE public.qa_test_plans
 ADD COLUMN IF NOT EXISTS load_test_approved boolean NOT NULL DEFAULT false,
 ADD COLUMN IF NOT EXISTS load_test_config_json jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.qa_test_cases
 ADD COLUMN IF NOT EXISTS scenario_type varchar(16) NOT NULL DEFAULT 'positive',
 ADD COLUMN IF NOT EXISTS test_data_json jsonb NOT NULL DEFAULT '{}'::jsonb,
 ADD COLUMN IF NOT EXISTS test_data_approved boolean NOT NULL DEFAULT false;

ALTER TABLE public.qa_test_runs
 ADD COLUMN IF NOT EXISTS load_test_metrics_json jsonb NULL;

ALTER TABLE public.qa_test_findings
 ADD COLUMN IF NOT EXISTS impact_analysis text NULL;
