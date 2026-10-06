BEGIN;
SET LOCAL ROLE postgres;
ALTER TABLE public.notification_recipients DISABLE TRIGGER dispatch_notification_recipient_push_after_insert;
SET LOCAL session_replication_role=replica;
INSERT INTO auth.users(id) VALUES ('bc000000-0000-4000-8000-000000000001'),('bc000000-0000-4000-8000-000000000002'),('bc000000-0000-4000-8000-000000000003'),('bc000000-0000-4000-8000-000000000004');
INSERT INTO public.employees(id,auth_user_id,name,surname,role,access_level,is_active,permissions,company_access_mode)
SELECT id::uuid,id::uuid,'Test',surname,'employee','unassigned',true,permissions,'all' FROM (VALUES
('bc000000-0000-4000-8000-000000000001','Magazyn',ARRAY['equipment_manage']),
('bc000000-0000-4000-8000-000000000002','Kierownik',ARRAY['events_view','events_own_only']),
('bc000000-0000-4000-8000-000000000003','Autor',ARRAY['events_manage']),
('bc000000-0000-4000-8000-000000000004','Obcy',ARRAY['events_view'])) v(id,surname,permissions);
INSERT INTO public.events(id,name,event_date,event_end_date,status,created_by,my_company_id,budget,final_cost)
VALUES ('bc000000-0000-4000-8000-000000000010','Test realizacji',now()+interval '7 days',now()+interval '8 days','in_preparation','bc000000-0000-4000-8000-000000000003',(SELECT id FROM public.my_companies LIMIT 1),12345,9876);
INSERT INTO public.employee_assignments(event_id,employee_id,status) VALUES('bc000000-0000-4000-8000-000000000010','bc000000-0000-4000-8000-000000000002','accepted');
INSERT INTO public.event_warehouse_handoffs(event_id,accepted_at,accepted_by_name,accepted_by) VALUES('bc000000-0000-4000-8000-000000000010',now(),'Test Magazyn','bc000000-0000-4000-8000-000000000001');
SET LOCAL session_replication_role=origin;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','bc000000-0000-4000-8000-000000000003',true);
SET LOCAL ROLE authenticated;
SELECT public.appoint_realization_manager('bc000000-0000-4000-8000-000000000010','bc000000-0000-4000-8000-000000000002')->>'manager_name';
SET LOCAL ROLE postgres;
SELECT set_config('request.jwt.claim.sub','bc000000-0000-4000-8000-000000000004',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF public.get_realization_workspace('bc000000-0000-4000-8000-000000000010') IS NOT NULL THEN RAISE EXCEPTION 'Stranger sees workspace'; END IF;
 BEGIN PERFORM public.advance_realization('bc000000-0000-4000-8000-000000000010','start'); RAISE EXCEPTION 'Stranger started'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.appoint_realization_manager('bc000000-0000-4000-8000-000000000010','bc000000-0000-4000-8000-000000000004'); RAISE EXCEPTION 'Stranger appointed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SET LOCAL ROLE postgres;
SELECT set_config('request.jwt.claim.sub','bc000000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
SELECT public.advance_warehouse_event('bc000000-0000-4000-8000-000000000010','ready')->>'ready_by_name';
DO $$ BEGIN
 BEGIN PERFORM public.advance_warehouse_event('bc000000-0000-4000-8000-000000000010','close'); RAISE EXCEPTION 'Warehouse closed'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN PERFORM public.advance_realization('bc000000-0000-4000-8000-000000000010','start'); RAISE EXCEPTION 'Warehouse started'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SET LOCAL ROLE postgres;
SELECT set_config('request.jwt.claim.sub','bc000000-0000-4000-8000-000000000002',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE result jsonb; first_result jsonb; BEGIN
 IF EXISTS(SELECT 1 FROM public.events WHERE id='bc000000-0000-4000-8000-000000000010') THEN RAISE EXCEPTION 'Leader reads financial event row'; END IF;
 result:=public.get_realization_workspace('bc000000-0000-4000-8000-000000000010');
 IF result IS NULL OR result->>'status'<>'ready_for_live' THEN RAISE EXCEPTION 'Workspace inaccessible %',result; END IF;
 IF result ?| ARRAY['budget','final_cost','contract','invoices'] THEN RAISE EXCEPTION 'Sensitive payload'; END IF;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(public.get_my_realizations()) e WHERE e->>'id'='bc000000-0000-4000-8000-000000000010') THEN RAISE EXCEPTION 'Manager list empty'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(public.get_events_list()) e WHERE e->>'id'='bc000000-0000-4000-8000-000000000010' AND (e->>'budget' IS NOT NULL OR e->>'final_cost' IS NOT NULL)) THEN RAISE EXCEPTION 'Calendar leaks financials'; END IF;
 BEGIN PERFORM public.get_event_financial_info('bc000000-0000-4000-8000-000000000010'); RAISE EXCEPTION 'Financial RPC leaks'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.get_event_financial_summary('bc000000-0000-4000-8000-000000000010'); RAISE EXCEPTION 'Summary RPC leaks'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.get_event_cash_summary('bc000000-0000-4000-8000-000000000010'); RAISE EXCEPTION 'Cash RPC leaks'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.get_event_invoices('bc000000-0000-4000-8000-000000000010'); RAISE EXCEPTION 'Invoice RPC leaks'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 IF public.get_event_details_for_user('bc000000-0000-4000-8000-000000000010','bc000000-0000-4000-8000-000000000002')::jsonb ? 'budget' THEN RAISE EXCEPTION 'Legacy detail leaks'; END IF;
 UPDATE public.events SET budget=0 WHERE id='bc000000-0000-4000-8000-000000000010';
 IF FOUND THEN RAISE EXCEPTION 'Direct write allowed'; END IF;
 first_result:=public.advance_realization('bc000000-0000-4000-8000-000000000010','start');
 IF public.advance_realization('bc000000-0000-4000-8000-000000000010','start')<>first_result THEN RAISE EXCEPTION 'Retry changed start'; END IF;
 first_result:=public.advance_realization('bc000000-0000-4000-8000-000000000010','complete','Uwagi testowe');
 IF first_result->>'completion_notes'<>'Uwagi testowe' THEN RAISE EXCEPTION 'Missing notes'; END IF;
 IF public.advance_realization('bc000000-0000-4000-8000-000000000010','complete','Nadpisanie')<>first_result THEN RAISE EXCEPTION 'Retry changed completion'; END IF;
END $$;
SET LOCAL ROLE postgres;
DO $$ BEGIN
 IF (SELECT status::text FROM public.events WHERE id='bc000000-0000-4000-8000-000000000010')<>'completed' THEN RAISE EXCEPTION 'Not completed'; END IF;
END $$;
-- Invoice state cannot advance warehouse completion to final closure.
UPDATE public.events SET status='invoiced' WHERE id='bc000000-0000-4000-8000-000000000010';
SELECT set_config('request.jwt.claim.sub','bc000000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF (SELECT status FROM public.get_event_operational_states(ARRAY['bc000000-0000-4000-8000-000000000010'::uuid]))<>'completed' THEN RAISE EXCEPTION 'Invoice changed operational completion'; END IF;
 BEGIN PERFORM public.advance_warehouse_event('bc000000-0000-4000-8000-000000000010','close'); RAISE EXCEPTION 'Warehouse closed invoiced event'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $$;
SET LOCAL ROLE postgres;
-- Existing commercial privileges are preserved for the author.
SELECT set_config('request.jwt.claim.sub','bc000000-0000-4000-8000-000000000003',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.events WHERE id='bc000000-0000-4000-8000-000000000010' AND budget=12345) THEN RAISE EXCEPTION 'Author lost financial access'; END IF;
END $$;
SET LOCAL ROLE postgres;
SELECT 'Operational realization tests passed';


-- A prepaid/future invoice must survive handover and must not replace manual completion.
SET LOCAL ROLE postgres;
UPDATE public.event_realizations SET started_at=NULL,started_by=NULL,completed_at=NULL,completed_by=NULL,completion_notes=NULL WHERE event_id='bc000000-0000-4000-8000-000000000010';
SELECT set_config('request.jwt.claim.sub','bc000000-0000-4000-8000-000000000002',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 PERFORM public.advance_realization('bc000000-0000-4000-8000-000000000010','start');
 IF public.get_realization_workspace('bc000000-0000-4000-8000-000000000010')->>'status'<>'in_progress' THEN RAISE EXCEPTION 'Invoice replaced operational start'; END IF;
 PERFORM public.advance_realization('bc000000-0000-4000-8000-000000000010','complete','Rozliczenie po realizacji');
 IF public.get_realization_workspace('bc000000-0000-4000-8000-000000000010')->>'status'<>'completed' THEN RAISE EXCEPTION 'No operational completion'; END IF;
END $$;
SET LOCAL ROLE postgres;
DO $$ BEGIN
 IF (SELECT status::text FROM public.events WHERE id='bc000000-0000-4000-8000-000000000010')<>'invoiced' THEN RAISE EXCEPTION 'Invoice state overwritten'; END IF;
END $$;
SELECT 'Prepaid realization tests passed';

SET LOCAL ROLE postgres;
UPDATE public.employees SET permissions=ARRAY['events_manage','events_own_only','equipment_manage'] WHERE id='bc000000-0000-4000-8000-000000000004';
SELECT set_config('request.jwt.claim.sub','bc000000-0000-4000-8000-000000000004',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF public.can_direct_realization('bc000000-0000-4000-8000-000000000010') THEN RAISE EXCEPTION 'Own-only manager can direct another event'; END IF;
 IF public.get_realization_workspace('bc000000-0000-4000-8000-000000000010') IS NOT NULL THEN RAISE EXCEPTION 'Own-only manager sees another workspace'; END IF;
END $$;
SET LOCAL ROLE postgres;
SELECT 'Own scope isolation passed';

ROLLBACK;