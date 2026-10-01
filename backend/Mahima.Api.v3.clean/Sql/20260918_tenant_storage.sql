-- Run during a maintenance window before deploying the API. Re-runnable.
-- GB means 1,000,000,000 bytes. Database usage is logical UTF-8 JSON row bytes,
-- excluding shared indexes/WAL/bloat and the operational tables listed below.
BEGIN;
CREATE TABLE IF NOT EXISTS public.tenant_storage_usage (
    tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
    database_bytes bigint NOT NULL DEFAULT 0 CHECK (database_bytes >= 0),
    file_bytes bigint NOT NULL DEFAULT 0 CHECK (file_bytes >= 0),
    limit_bytes bigint NOT NULL DEFAULT 10000000000 CHECK (limit_bytes > 0),
    files_measured_at timestamptz,
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- Child content (notably messages) inherits ownership from its tenant-scoped
-- parent. Persist ownership so cascading deletes can release bytes even after
-- the parent has disappeared. The ORM may continue omitting this column.
CREATE OR REPLACE FUNCTION public.inherit_storage_tenant()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner_id uuid;
BEGIN
    EXECUTE format('SELECT %I FROM public.%I WHERE %I::text=$1',TG_ARGV[3],TG_ARGV[0],TG_ARGV[1])
      INTO owner_id USING to_jsonb(NEW)->>TG_ARGV[2];
    IF owner_id IS NULL THEN
        RAISE EXCEPTION 'Cannot resolve tenant ownership for %', TG_TABLE_NAME;
    END IF;
    NEW := jsonb_populate_record(NEW,jsonb_build_object('tenant_id',owner_id));
    RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.propagate_storage_tenant()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF to_jsonb(OLD)->>TG_ARGV[2] IS DISTINCT FROM to_jsonb(NEW)->>TG_ARGV[2] THEN
        EXECUTE format('UPDATE public.%I SET tenant_id=$1 WHERE %I::text=$2',TG_ARGV[0],TG_ARGV[1])
          USING (to_jsonb(NEW)->>TG_ARGV[2])::uuid,to_jsonb(NEW)->>TG_ARGV[3];
    END IF;
    RETURN NULL;
END $$;

DO $$
DECLARE r record; parent_column text;
BEGIN
    -- Parents precede descendants. Optional modules are skipped when absent.
    FOR r IN SELECT * FROM (VALUES
      ('messages','chatid','chats','id'),
      ('chatmembers','chatid','chats','id'),
      ('messagereads','messageid','messages','id'),
      ('teammembers','teamid','teams','id'),
      ('prayerresponses','prayerrequestid','prayerrequests','id'),
      ('journal_lines','journal_entry_id','journal_entries','id'),
      ('counselling_cases','candidate_id','candidates','id'),
      ('counselling_sessions','case_id','counselling_cases','id')
    ) AS mappings(child,fk,parent,pk)
    LOOP
        IF to_regclass(format('public.%I',r.child)) IS NULL OR to_regclass(format('public.%I',r.parent)) IS NULL THEN CONTINUE; END IF;
        SELECT column_name INTO parent_column FROM information_schema.columns
          WHERE table_schema='public' AND table_name=r.parent AND column_name IN ('tenant_id','TenantId') LIMIT 1;
        IF parent_column IS NULL THEN RAISE EXCEPTION 'Missing tenant ownership on %',r.parent; END IF;
        EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS tenant_id uuid',r.child);
        -- Disable the previous meter while repairing ownership on a rerun.
        EXECUTE format('DROP TRIGGER IF EXISTS tenant_storage_meter ON public.%I',r.child);
        EXECUTE format('UPDATE public.%I c SET tenant_id=p.%I FROM public.%I p WHERE c.%I=p.%I',r.child,parent_column,r.parent,r.fk,r.pk);
        EXECUTE format('ALTER TABLE public.%I ALTER COLUMN tenant_id SET NOT NULL',r.child);
        EXECUTE format('DROP TRIGGER IF EXISTS inherit_storage_tenant ON public.%I',r.child);
        EXECUTE format('CREATE TRIGGER inherit_storage_tenant BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW
          EXECUTE FUNCTION public.inherit_storage_tenant(%L,%L,%L,%L)',r.child,r.parent,r.pk,r.fk,parent_column);
        EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I','storage_owner_'||r.child,r.parent);
        EXECUTE format('CREATE TRIGGER %I AFTER UPDATE ON public.%I FOR EACH ROW
          EXECUTE FUNCTION public.propagate_storage_tenant(%L,%L,%L,%L)',
          'storage_owner_'||r.child,r.parent,r.child,r.fk,parent_column,r.pk);
    END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.tenant_storage_limit(p_tenant uuid)
RETURNS bigint LANGUAGE sql STABLE AS $$
    SELECT greatest(1, (coalesce(max(coalesce(
        nullif(p.definition_json::jsonb->>'StorageLimitGb','')::numeric, 10)),10) * 1000000000)::bigint)
    FROM (SELECT DISTINCT ON (plan_id) * FROM public.tenant_subscriptions
          WHERE tenant_id=p_tenant ORDER BY plan_id,created_at_utc DESC,id) s
    LEFT JOIN public.subscription_plan_publications p ON p.plan_id=s.plan_id AND p.version=s.applied_plan_version
    WHERE s.status='active' AND s.starts_at_utc<=now()
      AND (s.ends_at_utc IS NULL OR s.ends_at_utc>now())
$$;

CREATE OR REPLACE FUNCTION public.tenant_storage_delta(p_tenant uuid, p_delta bigint)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE u public.tenant_storage_usage; root_tenant boolean;
BEGIN
    IF p_tenant IS NULL THEN RETURN; END IF;
    SELECT is_root_tenant INTO root_tenant FROM public.tenants WHERE id = p_tenant;
    IF NOT FOUND THEN RETURN; END IF; -- cascading tenant removal
    INSERT INTO public.tenant_storage_usage(tenant_id) VALUES(p_tenant) ON CONFLICT DO NOTHING;
    UPDATE public.tenant_storage_usage
       SET database_bytes = greatest(0, database_bytes + p_delta),
           limit_bytes=public.tenant_storage_limit(p_tenant), updated_at = now()
       WHERE tenant_id = p_tenant RETURNING * INTO u;
    IF NOT root_tenant AND p_delta > 0 AND u.database_bytes + u.file_bytes > u.limit_bytes THEN
        RAISE EXCEPTION USING ERRCODE = 'P5401', MESSAGE = 'Tenant storage allowance exceeded. Delete data or upgrade your package.';
    END IF;
END $$;

CREATE OR REPLACE FUNCTION public.track_tenant_storage()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE old_id uuid; new_id uuid; old_size bigint := 0; new_size bigint := 0;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        old_id := (to_jsonb(OLD)->>TG_ARGV[0])::uuid;
        old_size := octet_length(convert_to(to_jsonb(OLD)::text, 'UTF8'));
    END IF;
    IF TG_OP <> 'DELETE' THEN
        new_id := (to_jsonb(NEW)->>TG_ARGV[0])::uuid;
        new_size := octet_length(convert_to(to_jsonb(NEW)::text, 'UTF8'));
    END IF;
    IF old_id IS NOT DISTINCT FROM new_id THEN
        PERFORM public.tenant_storage_delta(new_id, new_size - old_size);
    ELSE
        -- Stable lock order when ownership changes.
        IF old_id < new_id THEN
            PERFORM public.tenant_storage_delta(old_id, -old_size);
            PERFORM public.tenant_storage_delta(new_id, new_size);
        ELSE
            PERFORM public.tenant_storage_delta(new_id, new_size);
            PERFORM public.tenant_storage_delta(old_id, -old_size);
        END IF;
    END IF;
    RETURN NULL;
END $$;

-- Lock all metered tables before rebuilding totals, so concurrent writes cannot
-- be lost between the backfill and trigger installation. Run again after adding tables.
DO $$
DECLARE r record;
BEGIN
    FOR r IN SELECT c.table_name, c.column_name FROM information_schema.columns c
      JOIN information_schema.tables t USING(table_schema,table_name)
      WHERE c.table_schema='public' AND t.table_type='BASE TABLE'
        AND c.column_name IN ('tenant_id','TenantId') AND c.data_type='uuid'
        AND c.table_name NOT IN ('tenant_storage_usage','NotificationQueue','AdminNotifications',
          'admin_notifications','adminnotifications','AuditLogs','audit_logs','tenant_subscriptions','tenant_module_licenses',
          'tenant_module_requests','payment_intents','payment_events','billing_invoices','billing_invoice_lines')
      ORDER BY c.table_name
    LOOP
        EXECUTE format('LOCK TABLE public.%I IN SHARE ROW EXCLUSIVE MODE', r.table_name);
    END LOOP;
    INSERT INTO public.tenant_storage_usage(tenant_id) SELECT id FROM public.tenants ON CONFLICT DO NOTHING;
    UPDATE public.tenant_storage_usage SET database_bytes=0;
    FOR r IN SELECT c.table_name, c.column_name FROM information_schema.columns c
      JOIN information_schema.tables t USING(table_schema,table_name)
      WHERE c.table_schema='public' AND t.table_type='BASE TABLE'
        AND c.column_name IN ('tenant_id','TenantId') AND c.data_type='uuid'
        AND c.table_name NOT IN ('tenant_storage_usage','NotificationQueue','AdminNotifications',
          'admin_notifications','adminnotifications','AuditLogs','audit_logs','tenant_subscriptions','tenant_module_licenses',
          'tenant_module_requests','payment_intents','payment_events','billing_invoices','billing_invoice_lines')
      ORDER BY c.table_name
    LOOP
        EXECUTE format('UPDATE public.tenant_storage_usage u SET database_bytes=u.database_bytes+s.bytes
          FROM (SELECT %I AS id, sum(octet_length(convert_to(to_jsonb(x)::text, ''UTF8'')))::bigint AS bytes
          FROM public.%I x GROUP BY %I) s WHERE u.tenant_id=s.id', r.column_name,r.table_name,r.column_name);
        EXECUTE format('DROP TRIGGER IF EXISTS tenant_storage_meter ON public.%I',r.table_name);
        EXECUTE format('CREATE TRIGGER tenant_storage_meter AFTER INSERT OR UPDATE OR DELETE ON public.%I
          FOR EACH ROW EXECUTE FUNCTION public.track_tenant_storage(%L)',r.table_name,r.column_name);
    END LOOP;
END $$;
COMMIT;
