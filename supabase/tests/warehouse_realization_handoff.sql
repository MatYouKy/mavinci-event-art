BEGIN;
SET LOCAL ROLE postgres;
-- Run in a transaction. Never send fixture notifications to push services.
ALTER TABLE public.notification_recipients DISABLE TRIGGER dispatch_notification_recipient_push_after_insert;
SET LOCAL session_replication_role=replica;
INSERT INTO auth.users(id) VALUES ('bd000000-0000-4000-8000-000000000001'),('bd000000-0000-4000-8000-000000000002'),('bd000000-0000-4000-8000-000000000003');
INSERT INTO public.employees(id,auth_user_id,name,surname,role,access_level,is_active,permissions,company_access_mode)
SELECT id::uuid,id::uuid,'Test',surname,'employee','unassigned',true,permissions,'all' FROM (VALUES
('bd000000-0000-4000-8000-000000000001','Magazyn A',ARRAY['equipment_manage','events_own_only']),
('bd000000-0000-4000-8000-000000000002','Magazyn B',ARRAY['equipment_manage']),
('bd000000-0000-4000-8000-000000000003','Sprzedawca',ARRAY['events_manage'])) v(id,surname,permissions);
INSERT INTO public.events(id,name,event_date,status,created_by,my_company_id)
VALUES ('bd000000-0000-4000-8000-000000000010','Test przekazania do magazynu',now()+interval '7 days','offer_sent','bd000000-0000-4000-8000-000000000003',(SELECT id FROM public.my_companies LIMIT 1));
SET LOCAL session_replication_role=origin;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','bd000000-0000-4000-8000-000000000003',true);
UPDATE public.events SET status='offer_accepted' WHERE id='bd000000-0000-4000-8000-000000000010';
UPDATE public.events SET status='offer_accepted' WHERE id='bd000000-0000-4000-8000-000000000010';
DO $$ BEGIN
 IF (SELECT count(*) FROM public.notifications WHERE metadata->>'warehouse_key'='warehouse-request:bd000000-0000-4000-8000-000000000010')<>1 THEN RAISE EXCEPTION 'Duplicate request'; END IF;
 IF (SELECT count(*) FROM public.notification_recipients r JOIN public.notifications n ON n.id=r.notification_id WHERE n.metadata->>'warehouse_key'='warehouse-request:bd000000-0000-4000-8000-000000000010' AND r.user_id IN ('bd000000-0000-4000-8000-000000000001','bd000000-0000-4000-8000-000000000002'))<>2 THEN RAISE EXCEPTION 'Warehouse recipients missing'; END IF;
END $$;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN PERFORM public.accept_warehouse_event('bd000000-0000-4000-8000-000000000010'); RAISE EXCEPTION 'Salesperson accepted without permission'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SET LOCAL ROLE postgres;
SELECT set_config('request.jwt.claim.sub','bd000000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE first_result jsonb; retry_result jsonb; BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.events WHERE id='bd000000-0000-4000-8000-000000000010') THEN RAISE EXCEPTION 'Warehouse cannot see event'; END IF;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(public.get_events_list()) e WHERE e->>'id'='bd000000-0000-4000-8000-000000000010') THEN RAISE EXCEPTION 'Calendar missing event'; END IF;
 first_result:=public.accept_warehouse_event('bd000000-0000-4000-8000-000000000010');
 retry_result:=public.accept_warehouse_event('bd000000-0000-4000-8000-000000000010');
 IF first_result<>retry_result OR first_result->>'accepted_by'<>'bd000000-0000-4000-8000-000000000001' THEN RAISE EXCEPTION 'Retry changed acknowledgement'; END IF;
 BEGIN UPDATE public.event_warehouse_handoffs SET accepted_by='bd000000-0000-4000-8000-000000000002' WHERE event_id='bd000000-0000-4000-8000-000000000010'; RAISE EXCEPTION 'Direct acknowledgement tampering allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SET LOCAL ROLE postgres;
SELECT set_config('request.jwt.claim.sub','bd000000-0000-4000-8000-000000000002',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF public.accept_warehouse_event('bd000000-0000-4000-8000-000000000010')->>'accepted_by'<>'bd000000-0000-4000-8000-000000000001' THEN RAISE EXCEPTION 'Second employee replaced first'; END IF;
END $$;
SET LOCAL ROLE postgres;
DO $$ BEGIN
 IF (SELECT status::text FROM public.events WHERE id='bd000000-0000-4000-8000-000000000010')<>'in_preparation' THEN RAISE EXCEPTION 'Status not updated'; END IF;
 IF (SELECT count(*) FROM public.notifications WHERE metadata->>'warehouse_key'='warehouse-accepted:bd000000-0000-4000-8000-000000000010')<>1 THEN RAISE EXCEPTION 'Duplicate acknowledgement'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.notification_recipients r JOIN public.notifications n ON n.id=r.notification_id WHERE r.user_id='bd000000-0000-4000-8000-000000000003' AND n.metadata->>'warehouse_key'='warehouse-accepted:bd000000-0000-4000-8000-000000000010') THEN RAISE EXCEPTION 'Seller confirmation missing'; END IF;
END $$;
UPDATE public.events SET status='cancelled' WHERE id='bd000000-0000-4000-8000-000000000010';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN PERFORM public.accept_warehouse_event('bd000000-0000-4000-8000-000000000010'); RAISE EXCEPTION 'Cancelled event accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SET LOCAL ROLE postgres;

ROLLBACK;