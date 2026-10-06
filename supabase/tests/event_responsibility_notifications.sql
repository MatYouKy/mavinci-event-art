-- Run after the migration inside a transaction and ROLLBACK. The fixtures
-- invoke production trigger functions on temporary rows, not real events.
CREATE TEMP TABLE test_realization (LIKE public.event_realizations);
CREATE TRIGGER test_realization AFTER INSERT OR UPDATE ON test_realization
 FOR EACH ROW EXECUTE FUNCTION public.notify_realization_responsibility();
CREATE TEMP TABLE test_handoff (LIKE public.event_warehouse_handoffs INCLUDING DEFAULTS);
CREATE TRIGGER test_handoff AFTER INSERT OR UPDATE ON test_handoff
 FOR EACH ROW EXECUTE FUNCTION public.notify_warehouse_ready();
DO $$
DECLARE ev uuid; manager uuid; company uuid; n uuid; c integer;
BEGIN
 SELECT r.event_id,r.manager_id,v.my_company_id INTO ev,manager,company
 FROM public.event_realizations r JOIN public.events v ON v.id=r.event_id
 JOIN public.employees e ON e.id=r.manager_id
 WHERE e.is_active AND public.employee_can_access_company(e.id,v.my_company_id) LIMIT 1;
 IF ev IS NULL THEN RAISE EXCEPTION 'Test requires one existing active realization manager'; END IF;
 INSERT INTO test_realization(event_id,manager_id,appointed_at) VALUES(ev,manager,clock_timestamp());
 SELECT id INTO STRICT n FROM public.notifications WHERE metadata->>'kind'='manager_appointed' AND metadata->>'event_id'=ev::text;
 SELECT count(*) INTO c FROM public.notification_recipients WHERE notification_id=n;
 IF c<>1 OR NOT EXISTS(SELECT 1 FROM public.notification_recipients WHERE notification_id=n AND user_id=manager)
 THEN RAISE EXCEPTION 'Appointment must notify only the designated manager'; END IF;
 UPDATE test_realization SET appointed_at=clock_timestamp();
 SELECT count(*) INTO c FROM public.notifications WHERE metadata->>'kind'='manager_appointed' AND metadata->>'event_id'=ev::text;
 IF c<>1 THEN RAISE EXCEPTION 'Repeated appointment created duplicate'; END IF;
 INSERT INTO test_handoff(event_id,ready_at) VALUES(ev,clock_timestamp());
 SELECT id INTO STRICT n FROM public.notifications WHERE metadata->>'event_operation_key'='ready:'||ev;
 IF NOT EXISTS(SELECT 1 FROM public.notification_recipients WHERE notification_id=n AND user_id=manager)
 THEN RAISE EXCEPTION 'Ready must notify manager'; END IF;
 UPDATE test_handoff SET ready_at=clock_timestamp();
 SELECT count(*) INTO c FROM public.notifications WHERE metadata->>'event_operation_key'='ready:'||ev;
 IF c<>1 THEN RAISE EXCEPTION 'Repeated readiness created duplicate'; END IF;
 UPDATE test_realization SET started_at=clock_timestamp();
 UPDATE test_realization SET completed_at=clock_timestamp();
 UPDATE test_realization SET completed_at=clock_timestamp();
 SELECT count(*) INTO c FROM public.notifications WHERE metadata->>'event_id'=ev::text AND metadata ? 'event_operation_key';
 IF c<>4 THEN RAISE EXCEPTION 'Expected exactly four lifecycle notifications, got %',c; END IF;
 IF EXISTS(SELECT 1 FROM public.notification_recipients nr JOIN public.notifications n ON n.id=nr.notification_id
 JOIN public.employees e ON e.id=nr.user_id WHERE n.metadata ? 'event_operation_key' AND
 (NOT e.is_active OR NOT public.employee_can_access_company(e.id,company)))
 THEN RAISE EXCEPTION 'Recipient outside active company scope'; END IF;
 RAISE NOTICE 'PASS: appointment, readiness, start, completion, duplicate prevention, company scope';
END $$;
