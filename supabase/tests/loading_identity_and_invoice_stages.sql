-- Run against a database with an active warehouse employee and unlocked equipment. All writes roll back.
BEGIN;
DO $$ DECLARE v_equipment uuid; v_user uuid; v_employee uuid; v_event uuid; v_loaded boolean;
BEGIN
 SELECT q.id,coalesce(e.auth_user_id,e.id),e.id,q.event_id INTO v_equipment,v_user,v_employee,v_event
 FROM public.event_equipment q JOIN public.events ev ON ev.id=q.event_id
 CROSS JOIN public.employees e
 WHERE e.is_active AND EXISTS(SELECT 1 FROM auth.users u WHERE u.id=coalesce(e.auth_user_id,e.id))
 AND public.employee_can_prepare_event(e.id,q.event_id) AND NOT coalesce(ev.loading_locked,false)
 LIMIT 1;
 IF v_equipment IS NULL THEN RAISE EXCEPTION 'Brak próbki magazyniera do testu'; END IF;
 PERFORM set_config('request.jwt.claim.sub',v_user::text,true);
 PERFORM set_config('request.jwt.claim.role','authenticated',true);
 PERFORM public.set_event_equipment_loaded(v_equipment,true);
 IF NOT EXISTS(SELECT 1 FROM public.event_equipment WHERE id=v_equipment AND is_loaded AND loaded_by=v_user) THEN RAISE EXCEPTION 'Nie zapisano konta autoryzowanego'; END IF;
 PERFORM public.set_event_equipment_loaded(v_equipment,false);
 IF NOT EXISTS(SELECT 1 FROM public.event_equipment WHERE id=v_equipment AND NOT is_loaded AND loaded_by IS NULL AND loaded_at IS NULL) THEN RAISE EXCEPTION 'Nie cofnięto załadunku'; END IF;
 PERFORM set_config('request.jwt.claim.sub','',true);
 BEGIN
  PERFORM public.set_event_equipment_loaded(v_equipment,true);
  RAISE EXCEPTION 'Brak blokady niezalogowanego';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 RAISE NOTICE 'PASS: zapis i cofnięcie załadunku, auth UID, blokada niezalogowanego';
END; $$;
SELECT 'advance_only_state',coalesce(public.event_invoice_lifecycle_state(e.id),'NULL') FROM public.events e
WHERE EXISTS(SELECT 1 FROM public.invoices i WHERE i.event_id=e.id AND i.invoice_type='advance')
AND NOT EXISTS(SELECT 1 FROM public.invoices i WHERE i.event_id=e.id AND i.invoice_type IN ('vat','final') AND i.status IN ('issued','sent','paid','overdue'));
-- Exercise the installed sync function with isolated events and controlled invoice evidence.
CREATE TEMP TABLE test_invoice_events(id uuid PRIMARY KEY,status text,updated_at timestamptz);
CREATE FUNCTION pg_temp.test_invoice_target(uuid) RETURNS text LANGUAGE sql AS $$ SELECT 'invoiced'::text $$;
CREATE FUNCTION pg_temp.test_payment_plan(uuid) RETURNS void LANGUAGE plpgsql AS $$ BEGIN RETURN; END $$;
DO $$ DECLARE definition text; stage text; result text; test_id uuid:=gen_random_uuid(); BEGIN
 definition:=pg_get_functiondef('public.sync_event_invoice_lifecycle(uuid)'::regprocedure);
 definition:=replace(definition,'public.sync_event_invoice_lifecycle','pg_temp.test_sync');
 definition:=replace(definition,'public.events','pg_temp.test_invoice_events');
 definition:=replace(definition,'public.event_invoice_lifecycle_state','pg_temp.test_invoice_target');
 definition:=replace(definition,'public.sync_event_payment_plan_invoices','pg_temp.test_payment_plan');
 EXECUTE definition;
 FOREACH stage IN ARRAY ARRAY['offer_accepted','in_preparation','ready_for_live','in_progress','cancelled','completed'] LOOP
  INSERT INTO test_invoice_events VALUES(test_id,stage,now());
  PERFORM pg_temp.test_sync(test_id);
  SELECT status INTO result FROM test_invoice_events WHERE id=test_id;
  IF result IS DISTINCT FROM (CASE WHEN stage='completed' THEN 'invoiced' ELSE stage END) THEN
   RAISE EXCEPTION 'Nieprawidłowa zmiana etapu % na %',stage,result;
  END IF;
  DELETE FROM test_invoice_events WHERE id=test_id;
 END LOOP;
END $$;
ROLLBACK;
