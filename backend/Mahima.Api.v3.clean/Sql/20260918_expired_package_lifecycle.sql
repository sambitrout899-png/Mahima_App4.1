-- Apply after package publishing migrations. Retains historical billing records.
BEGIN;
CREATE OR REPLACE FUNCTION public.retire_unavailable_package()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.lifecycle_status='deleted' AND NEW.lifecycle_status<>'deleted' THEN
        RAISE EXCEPTION USING ERRCODE='P5403',MESSAGE='Deleted packages cannot be restored.';
    END IF;
    IF NEW.lifecycle_status NOT IN ('expired','deleted') THEN RETURN NEW; END IF;
    UPDATE public.tenant_subscriptions SET status='expired',ends_at_utc=now(),updated_at_utc=now()
      WHERE plan_id=NEW.id AND status NOT IN ('expired','terminated');
    UPDATE public.tenant_module_licenses SET status='expired',ends_at_utc=now(),updated_at_utc=now()
      WHERE source='plan:'||left(replace(NEW.id::text,'-',''),27) AND status='active';
    UPDATE public.subscription_plan_publications SET expired_at_utc=coalesce(expired_at_utc,now()) WHERE plan_id=NEW.id;
    IF to_regclass('public.package_version_upgrade_requests') IS NOT NULL THEN
        EXECUTE 'UPDATE public.package_version_upgrade_requests SET status=''cancelled'',decided_at_utc=now() WHERE plan_id=$1 AND status=''pending''' USING NEW.id;
    END IF;
    IF to_regclass('public.package_payment_requests') IS NOT NULL THEN
        EXECUTE 'UPDATE public.package_payment_requests SET status=''rejected'',review_note=''Package is no longer available'',reviewed_at_utc=now() WHERE plan_id=$1 AND status=''pending''' USING NEW.id;
    END IF;
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS retire_unavailable_package ON public.subscription_plans;
CREATE TRIGGER retire_unavailable_package AFTER UPDATE OF lifecycle_status,enabled ON public.subscription_plans
FOR EACH ROW EXECUTE FUNCTION public.retire_unavailable_package();

CREATE OR REPLACE FUNCTION public.guard_package_activation()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE package_id uuid; allowed boolean;
BEGIN
    IF NEW.status<>'active' THEN RETURN NEW; END IF;
    IF TG_TABLE_NAME='tenant_subscriptions' THEN
        package_id := NEW.plan_id;
    ELSE
        IF NEW.source NOT LIKE 'plan:%' THEN RETURN NEW; END IF;
        SELECT id INTO package_id FROM public.subscription_plans
          WHERE 'plan:'||left(replace(id::text,'-',''),27)=NEW.source;
    END IF;
    -- Row lock serializes activation with expiry/deletion across API instances.
    SELECT enabled AND lifecycle_status='published' INTO allowed
      FROM public.subscription_plans WHERE id=package_id FOR SHARE;
    IF allowed IS DISTINCT FROM true THEN
        RAISE EXCEPTION USING ERRCODE='P5403',MESSAGE='This package is no longer available.';
    END IF;
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS guard_package_activation ON public.tenant_subscriptions;
CREATE TRIGGER guard_package_activation BEFORE INSERT OR UPDATE ON public.tenant_subscriptions
FOR EACH ROW EXECUTE FUNCTION public.guard_package_activation();
DROP TRIGGER IF EXISTS guard_package_activation ON public.tenant_module_licenses;
CREATE TRIGGER guard_package_activation BEFORE INSERT OR UPDATE ON public.tenant_module_licenses
FOR EACH ROW EXECUTE FUNCTION public.guard_package_activation();

-- Repair packages expired before this policy was introduced.
UPDATE public.subscription_plans SET enabled=false WHERE lifecycle_status IN ('expired','deleted');
COMMIT;
