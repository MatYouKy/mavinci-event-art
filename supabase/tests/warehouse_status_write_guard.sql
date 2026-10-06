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

DO $$ BEGIN
 BEGIN UPDATE public.events SET status='ready_for_live' WHERE id='bc000000-0000-4000-8000-000000000010'; RAISE EXCEPTION 'Seller changed warehouse status'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 UPDATE public.events SET status='offer_accepted' WHERE id='bc000000-0000-4000-8000-000000000010';
 BEGIN UPDATE public.events SET status='in_preparation' WHERE id='bc000000-0000-4000-8000-000000000010'; RAISE EXCEPTION 'Seller started preparation'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SET LOCAL ROLE postgres;
DELETE FROM public.event_warehouse_handoffs WHERE event_id='bc000000-0000-4000-8000-000000000010';
SELECT set_config('request.jwt.claim.sub','bc000000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
SELECT public.accept_warehouse_event('bc000000-0000-4000-8000-000000000010')->>'accepted_by_name';
DO $$ BEGIN
 IF (SELECT status::text FROM public.events WHERE id='bc000000-0000-4000-8000-000000000010')<>'in_preparation' THEN RAISE EXCEPTION 'Warehouse acceptance blocked'; END IF;
END $$;
ROLLBACK;
