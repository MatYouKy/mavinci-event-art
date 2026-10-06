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
DO $$ DECLARE snapshot jsonb; BEGIN
 snapshot:=public.get_event_realization_assignment('bc000000-0000-4000-8000-000000000010');
 IF NOT (snapshot->>'can_manage')::boolean OR snapshot->'realization'->>'manager_id'<>'bc000000-0000-4000-8000-000000000002' THEN RAISE EXCEPTION 'Assignment state incorrect'; END IF;
 BEGIN PERFORM public.revoke_realization_manager('bc000000-0000-4000-8000-000000000010','bc000000-0000-4000-8000-000000000004'); RAISE EXCEPTION 'Stale revoke allowed'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $$;
SET LOCAL ROLE postgres;
SELECT set_config('request.jwt.claim.sub','bc000000-0000-4000-8000-000000000002',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF NOT public.is_realization_manager('bc000000-0000-4000-8000-000000000010') THEN RAISE EXCEPTION 'Appointment failed'; END IF;
 BEGIN PERFORM public.revoke_realization_manager('bc000000-0000-4000-8000-000000000010','bc000000-0000-4000-8000-000000000002'); RAISE EXCEPTION 'Manager granted own revocation'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SET LOCAL ROLE postgres;
SELECT set_config('request.jwt.claim.sub','bc000000-0000-4000-8000-000000000003',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE first_result jsonb; BEGIN
 first_result:=public.revoke_realization_manager('bc000000-0000-4000-8000-000000000010','bc000000-0000-4000-8000-000000000002');
 IF first_result->>'manager_id' IS NOT NULL THEN RAISE EXCEPTION 'Revocation failed'; END IF;
 IF public.revoke_realization_manager('bc000000-0000-4000-8000-000000000010','bc000000-0000-4000-8000-000000000002')<>first_result THEN RAISE EXCEPTION 'Retry changed state'; END IF;
END $$;
SET LOCAL ROLE postgres;
SELECT set_config('request.jwt.claim.sub','bc000000-0000-4000-8000-000000000002',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF public.is_realization_manager('bc000000-0000-4000-8000-000000000010') THEN RAISE EXCEPTION 'Retained manager access'; END IF;
 BEGIN PERFORM public.advance_realization('bc000000-0000-4000-8000-000000000010','start'); RAISE EXCEPTION 'Revoked leader started'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SET LOCAL ROLE postgres;
SELECT set_config('request.jwt.claim.sub','bc000000-0000-4000-8000-000000000003',true);
SET LOCAL ROLE authenticated;
SELECT public.appoint_realization_manager('bc000000-0000-4000-8000-000000000010','bc000000-0000-4000-8000-000000000002')->>'manager_name';
SET LOCAL ROLE postgres;
UPDATE public.event_realizations SET completed_at=now(),completion_notes='Historia realizacji' WHERE event_id='bc000000-0000-4000-8000-000000000010';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF (public.get_event_realization_assignment('bc000000-0000-4000-8000-000000000010')->>'can_change')::boolean THEN RAISE EXCEPTION 'Completed change enabled'; END IF;
 BEGIN PERFORM public.revoke_realization_manager('bc000000-0000-4000-8000-000000000010','bc000000-0000-4000-8000-000000000002'); RAISE EXCEPTION 'Completed revoked'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $$;
ROLLBACK;
