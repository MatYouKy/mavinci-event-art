-- Run after the migration; all fixture data is rolled back.
BEGIN;
SET LOCAL ROLE postgres;
SELECT set_config('request.jwt.claim.role','authenticated',true);
INSERT INTO auth.users(id) VALUES ('bb000000-0000-4000-8000-000000000001');
INSERT INTO public.employees(id,auth_user_id,role,access_level,is_active,permissions) VALUES ('bb000000-0000-4000-8000-000000000001','bb000000-0000-4000-8000-000000000001','employee','unassigned',true,ARRAY['equipment_view']);
SELECT set_config('request.jwt.claim.sub','bb000000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF public.crm_contract_permission('view') THEN RAISE EXCEPTION 'Unassigned viewer allowed'; END IF;
 IF EXISTS(SELECT 1 FROM public.contracts) THEN RAISE EXCEPTION 'Unassigned viewer read contracts'; END IF;
 BEGIN
 PERFORM public.admin_set_employee_section_permissions('bb000000-0000-4000-8000-000000000001','contracts',ARRAY['contracts_manage'],'{}');
 RAISE EXCEPTION 'Non-admin changed permissions';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SET LOCAL ROLE postgres;
SELECT set_config('request.jwt.claim.sub',coalesce(auth_user_id,id)::text,true) FROM public.employees WHERE is_active AND role='admin' LIMIT 1;
SET LOCAL ROLE authenticated;
SELECT public.admin_set_employee_section_permissions('bb000000-0000-4000-8000-000000000001','contracts',ARRAY['contracts_view'],'{}');
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.employees WHERE id='bb000000-0000-4000-8000-000000000001' AND permissions @> ARRAY['equipment_view','contracts_view'] AND NOT role_permissions_inherited) THEN RAISE EXCEPTION 'Other scopes lost or no canonical update'; END IF;
 BEGIN
 PERFORM public.admin_set_employee_section_permissions('bb000000-0000-4000-8000-000000000001','contracts',ARRAY['contracts_manage'],'{}');
 RAISE EXCEPTION 'Stale update allowed';
 EXCEPTION WHEN serialization_failure THEN NULL; END;
END $$;
SET LOCAL ROLE postgres;
SELECT set_config('request.jwt.claim.sub','bb000000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE n integer; BEGIN
 IF NOT public.crm_contract_permission('view') OR public.crm_contract_permission('manage') OR public.crm_contract_permission('create') THEN RAISE EXCEPTION 'View permission mismatch'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.contracts) THEN RAISE EXCEPTION 'Assigned viewer cannot see any contracts'; END IF;
 UPDATE public.contracts SET title=title;
 GET DIAGNOSTICS n=ROW_COUNT;
 IF n<>0 THEN RAISE EXCEPTION 'Viewer modified contracts'; END IF;
END $$;
SET LOCAL ROLE postgres;
SELECT set_config('request.jwt.claim.sub',coalesce(auth_user_id,id)::text,true) FROM public.employees WHERE is_active AND role='admin' LIMIT 1;
SET LOCAL ROLE authenticated;
SELECT public.admin_set_employee_section_permissions('bb000000-0000-4000-8000-000000000001','contracts','{}',ARRAY['contracts_view']);
SET LOCAL ROLE postgres;
SELECT set_config('request.jwt.claim.sub','bb000000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.contracts) THEN RAISE EXCEPTION 'Revoked viewer still sees contracts'; END IF;
END $$;
SET LOCAL ROLE postgres;

ROLLBACK;