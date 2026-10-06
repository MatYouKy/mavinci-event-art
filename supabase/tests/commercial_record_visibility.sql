BEGIN;
SET LOCAL ROLE postgres;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SET LOCAL session_replication_role=replica;
INSERT INTO auth.users(id) VALUES ('bc000000-0000-4000-8000-000000000001'),('bc000000-0000-4000-8000-000000000002'),('bc000000-0000-4000-8000-000000000101');
INSERT INTO public.employees(id,auth_user_id,role,access_level,is_active,permissions,company_access_mode)
VALUES ('bc000000-0000-4000-8000-000000000001','bc000000-0000-4000-8000-000000000101','employee','unassigned',true,ARRAY['contracts_manage','contracts_own_only','offers_manage','offers_own_only','events_manage','events_own_only'],'all'),
('bc000000-0000-4000-8000-000000000002','bc000000-0000-4000-8000-000000000002','employee','unassigned',true,'{}','all');
INSERT INTO public.contacts(id,first_name,last_name,owner_id) VALUES ('bc000000-0000-4000-8000-000000000010','Test','Zakres','bc000000-0000-4000-8000-000000000001');
INSERT INTO public.events(id,name,event_date,created_by,contact_person_id,my_company_id)
SELECT v.id::uuid,'Test zakresu',now(),v.creator::uuid,v.contact::uuid,(SELECT id FROM public.my_companies LIMIT 1) FROM (VALUES
('bc000000-0000-4000-8000-000000000011','bc000000-0000-4000-8000-000000000001',NULL),
('bc000000-0000-4000-8000-000000000012','bc000000-0000-4000-8000-000000000002',NULL),
('bc000000-0000-4000-8000-000000000013','bc000000-0000-4000-8000-000000000002','bc000000-0000-4000-8000-000000000010')) v(id,creator,contact);
INSERT INTO public.offers(id,event_id,created_by,my_company_id)
SELECT replace(id::text,'00000000001','00000000002')::uuid,id,created_by,my_company_id FROM public.events WHERE id::text LIKE 'bc000000-%';
INSERT INTO public.contracts(id,contract_number,title,content,created_by,event_id)
SELECT replace(id::text,'00000000001','00000000003')::uuid,'TEST-'||id::text,'Test','Test',NULL,id FROM public.events WHERE id::text LIKE 'bc000000-%';
SET LOCAL session_replication_role=origin;
SELECT set_config('request.jwt.claim.sub','bc000000-0000-4000-8000-000000000101',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE n int; calendar jsonb; BEGIN
 SELECT count(*) INTO n FROM public.events WHERE id::text LIKE 'bc000000-%';
 IF n<>2 THEN RAISE EXCEPTION 'Own events expected 2 got %',n; END IF;
 SELECT count(*) INTO n FROM public.offers WHERE id::text LIKE 'bc000000-%';
 IF n<>2 THEN RAISE EXCEPTION 'Own offers expected 2 got %',n; END IF;
 SELECT count(*) INTO n FROM public.contracts WHERE id::text LIKE 'bc000000-%';
 IF n<>2 THEN RAISE EXCEPTION 'Own contracts expected 2 got %',n; END IF;
 UPDATE public.contracts SET title='Forbidden' WHERE id='bc000000-0000-4000-8000-000000000032';
 GET DIAGNOSTICS n=ROW_COUNT;
 IF n<>0 THEN RAISE EXCEPTION 'Updated foreign contract'; END IF;
 DELETE FROM public.offers WHERE id='bc000000-0000-4000-8000-000000000022';
 GET DIAGNOSTICS n=ROW_COUNT;
 IF n<>0 THEN RAISE EXCEPTION 'Deleted foreign offer'; END IF;
 SELECT public.get_events_list() INTO calendar;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(calendar) e WHERE e->>'id'='bc000000-0000-4000-8000-000000000012') THEN RAISE EXCEPTION 'Calendar leaked event'; END IF;
 IF EXISTS(SELECT 1 FROM public.get_event_financial_summary('bc000000-0000-4000-8000-000000000012')) THEN RAISE EXCEPTION 'Financial RPC leaked event'; END IF;
 IF public.can_view_event_commercials('bc000000-0000-4000-8000-000000000012') THEN RAISE EXCEPTION 'Commercial authorizer leaked event'; END IF;
 BEGIN
 UPDATE public.contracts SET created_by='bc000000-0000-4000-8000-000000000002' WHERE id='bc000000-0000-4000-8000-000000000031';
 RAISE EXCEPTION 'Spoofed creator';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SET LOCAL ROLE postgres;
SELECT set_config('request.jwt.claim.sub',coalesce(auth_user_id,id)::text,true) FROM public.employees WHERE is_active AND role='admin' LIMIT 1;
SET LOCAL ROLE authenticated;
SELECT public.admin_set_employee_section_permissions('bc000000-0000-4000-8000-000000000001','events',ARRAY['events_view','events_own_only'],ARRAY['events_manage','events_own_only']);
SET LOCAL ROLE postgres;
SELECT set_config('request.jwt.claim.sub','bc000000-0000-4000-8000-000000000101',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.events WHERE id='bc000000-0000-4000-8000-000000000013') THEN RAISE EXCEPTION 'Assigned owner cannot read event'; END IF;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(public.get_events_list()) e WHERE e->>'id'='bc000000-0000-4000-8000-000000000013') THEN RAISE EXCEPTION 'Assigned owner calendar missing'; END IF;
END $$;
SET LOCAL ROLE postgres;
SELECT set_config('request.jwt.claim.sub',coalesce(auth_user_id,id)::text,true) FROM public.employees WHERE is_active AND role='admin' LIMIT 1;
SET LOCAL ROLE authenticated;
SELECT public.admin_set_employee_section_permissions('bc000000-0000-4000-8000-000000000001','contracts',ARRAY['contracts_create','contracts_own_only'],ARRAY['contracts_manage','contracts_own_only']);
SET LOCAL ROLE postgres;
SELECT set_config('request.jwt.claim.sub','bc000000-0000-4000-8000-000000000101',true);
SET LOCAL ROLE authenticated;
INSERT INTO public.contracts(id,contract_number,title,content) VALUES ('bc000000-0000-4000-8000-000000000040','SCOPE-TEST-CREATE','Test','Test');
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.contracts WHERE id='bc000000-0000-4000-8000-000000000040' AND created_by='bc000000-0000-4000-8000-000000000001') THEN RAISE EXCEPTION 'Creator cannot read new contract'; END IF;
 IF public.crm_contract_permission('manage') THEN RAISE EXCEPTION 'Create escalated to manage'; END IF;
END $$;
SET LOCAL ROLE postgres;
SELECT set_config('request.jwt.claim.sub',coalesce(auth_user_id,id)::text,true) FROM public.employees WHERE is_active AND role='admin' LIMIT 1;
SET LOCAL ROLE authenticated;
SELECT public.admin_set_employee_section_permissions('bc000000-0000-4000-8000-000000000001','contracts',ARRAY['contracts_view'],ARRAY['contracts_create','contracts_own_only']);
SET LOCAL ROLE postgres;
SELECT set_config('request.jwt.claim.sub','bc000000-0000-4000-8000-000000000101',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.contracts WHERE id='bc000000-0000-4000-8000-000000000032') THEN RAISE EXCEPTION 'All scope cannot see foreign contract'; END IF;
END $$;
SET LOCAL ROLE postgres;

ROLLBACK;